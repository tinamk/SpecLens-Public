import Stripe from "stripe";
import { stripeWebhookInputSchema, type StripeWebhookInput } from "@speclens/contracts";
import { statusError } from "@speclens/db";

let stripeClient: Stripe | null | undefined;
let stripeClientSecret: string | null | undefined;

function createStripeUtilityClient(secretKey: string | null): Stripe {
  return new Stripe(secretKey ?? "sk_test_speclens_webhook_only", {
    apiVersion: "2025-08-27.basil",
  });
}

export type StripeWebhookParseResult =
  | {
      kind: "handled";
      eventType: string;
      payload: StripeWebhookInput;
    }
  | {
      kind: "ignored";
      eventType: string;
    };

function readSecret(value: string | null | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function getStripeClient(): Stripe | null {
  const secretKey = readSecret(process.env.STRIPE_SECRET_KEY);
  if (stripeClient !== undefined && stripeClientSecret === secretKey) {
    return stripeClient;
  }
  stripeClientSecret = secretKey;
  stripeClient = secretKey ? createStripeUtilityClient(secretKey) : null;
  return stripeClient;
}

export function hasLiveStripeConfig(): boolean {
  return Boolean(getStripeClient() && readSecret(process.env.STRIPE_PRICE_PRO_MONTHLY_USD));
}

export function parseStripeMonthlyPriceConfig(rawValue: string): { kind: "price"; priceId: string } | { kind: "amount"; unitAmount: number } {
  const trimmed = rawValue.trim();
  if (trimmed.startsWith("price_")) {
    return { kind: "price", priceId: trimmed };
  }
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw statusError(500, `Invalid STRIPE_PRICE_PRO_MONTHLY_USD value: ${rawValue}`);
  }
  return {
    kind: "amount",
    unitAmount: Math.round(amount * 100),
  };
}

export async function createStripeCheckoutSession(input: {
  userId: string;
  workspaceId: string | null;
  successUrl: string;
  cancelUrl: string;
  priceConfig: string;
}): Promise<{ id: string; checkoutUrl: string }> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw statusError(500, "STRIPE_SECRET_KEY is required for live Stripe checkout.");
  }
  const priceConfig = parseStripeMonthlyPriceConfig(input.priceConfig);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      priceConfig.kind === "price"
        ? {
            price: priceConfig.priceId,
            quantity: 1,
          }
        : {
            price_data: {
              currency: "usd",
              recurring: {
                interval: "month",
              },
              product_data: {
                name: "SpecLens Pro",
                description: "Hosted monthly access for private repositories and durable analysis runs.",
              },
              unit_amount: priceConfig.unitAmount,
            },
            quantity: 1,
          },
    ],
    success_url: input.successUrl.includes("{CHECKOUT_SESSION_ID}")
      ? input.successUrl
      : `${input.successUrl}${input.successUrl.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
    metadata: {
      userId: input.userId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      plan: "pro",
    },
    subscription_data: {
      metadata: {
        userId: input.userId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        plan: "pro",
      },
    },
  });

  if (!session.url) {
    throw statusError(500, "Stripe did not return a hosted checkout URL.");
  }

  return {
    id: session.id,
    checkoutUrl: session.url,
  };
}

export async function createStripeBillingPortalSession(input: {
  customerId: string | null;
  returnUrl: string;
}): Promise<{ manageUrl: string }> {
  const stripe = getStripeClient();
  if (!stripe) {
    return {
      manageUrl: `${input.returnUrl}${input.returnUrl.includes("?") ? "&" : "?"}billing=managed`,
    };
  }
  if (!input.customerId) {
    throw statusError(404, "No billing customer is available for this account yet.");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return {
    manageUrl: session.url,
  };
}

export function parseStripeWebhookPayload(request: {
  headers: { "stripe-signature"?: string | string[] | undefined };
  body: unknown;
  rawBody?: Buffer | null;
}): StripeWebhookParseResult {
  const webhookSecret = readSecret(process.env.STRIPE_WEBHOOK_SECRET);
  if (!webhookSecret) {
    throw statusError(503, "STRIPE_WEBHOOK_SECRET is required to accept Stripe webhooks.");
  }
  const signature = Array.isArray(request.headers["stripe-signature"])
    ? request.headers["stripe-signature"][0]
    : request.headers["stripe-signature"];

  if (!signature) {
    throw statusError(401, "Missing Stripe webhook signature.");
  }
  if (!request.rawBody) {
    throw statusError(400, "Raw request body is required to verify Stripe webhook signatures.");
  }

  const stripe = getStripeClient() ?? createStripeUtilityClient(null);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(request.rawBody, signature, webhookSecret);
  } catch (error) {
    throw statusError(401, error instanceof Error ? error.message : "Invalid Stripe webhook signature.");
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    return {
      kind: "handled",
      eventType: event.type,
      payload: stripeWebhookInputSchema.parse({
        type: "checkout.session.completed",
        eventId: event.id,
        sessionId: session.id,
        userId: session.metadata?.userId ?? session.client_reference_id ?? undefined,
        subscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
        customerId: typeof session.customer === "string" ? session.customer : undefined,
      }),
    };
  }

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      kind: "handled",
      eventType: event.type,
      payload: stripeWebhookInputSchema.parse({
        type: "customer.subscription.deleted",
        eventId: event.id,
        subscriptionId: subscription.id,
        userId: subscription.metadata?.userId,
        customerId: typeof subscription.customer === "string" ? subscription.customer : undefined,
        status: subscription.status,
      }),
    };
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    return {
      kind: "handled",
      eventType: event.type,
      payload: stripeWebhookInputSchema.parse({
        type: "customer.subscription.updated",
        eventId: event.id,
        subscriptionId: subscription.id,
        userId: subscription.metadata?.userId,
        customerId: typeof subscription.customer === "string" ? subscription.customer : undefined,
        status: subscription.status,
      }),
    };
  }

  return {
    kind: "ignored",
    eventType: event.type,
  };
}

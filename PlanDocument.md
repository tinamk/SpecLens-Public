SpecLens AI — Self‑Bootstrapping Spec‑Driven
Development
Background and Motivation
AI-powered coding tools have surged in popularity, allowing developers to generate code from naturallanguage prompts. However, relying on improvised prompts (so-called “vibe coding”) can lead to context
loss and brittle results . In complex systems, an AI may produce code that technically works but
doesn’t fit the project’s architecture or requirements, forcing developers into many corrective iterations
. There is a growing need for a more systematic approach that keeps humans in control of the
process while harnessing AI’s speed . Spec-driven development (SDD) has emerged to meet this
need. In SDD, a clear specification is written before any code, and this “spec” becomes the guiding
source of truth for both the human and the AI throughout development . By shifting focus to
upfront specifications, teams aim to maximize AI-assisted productivity without sacrificing software
quality or maintainability.
What is Spec-Driven Development?
Spec-driven development is a paradigm where well-crafted software requirement specifications serve as
the primary inputs (prompts) for an AI coding agent to generate executable code . Instead of
treating code as the starting point, SDD treats a specification as the blueprint of the feature. A spec is
typically a structured, behavior-oriented artifact written in natural language, expressing the intended
functionality, constraints, and acceptance criteria of the software . In practice, providing a
comprehensive spec flips the traditional AI coding model: rather than the AI guessing requirements
through trial-and-error dialog, the AI is given a complete picture of what to build and what not to build
up front . This yields several benefits over ad-hoc prompting:
Upfront Clarity: The AI works from a detailed description of the feature, reducing ambiguity and
hidden assumptions .
Single Source of Truth: The spec serves as a persistent reference for both developers and AI,
ensuring everyone is aligned on requirements .
Context Preservation: Relevant context (business rules, integration points, constraints) is
documented in the spec, preventing the AI from diverging into irrelevant or duplicate
functionality .
Predictable Outcomes: With explicit guidance, the code generated is more likely to meet the
expected behavior and quality standards, avoiding the unpredictability of prompt-only coding
.
Notably, SDD builds on ideas from behavior-driven development (BDD) and test-driven development. In
BDD, for example, specifications in the form of scenarios (Given/When/Then) act as living
documentation of system behavior and are verified through automated tests in CI pipelines . SDD
generalizes this idea: the spec isn’t just documentation or tests, but a driving artifact for code
generation. The industry is still refining what “counts” as a spec (ranging from high-level product
requirements to more formal technical specs), but the core idea is consistent – write the spec first, then
use it to generate and validate code. As one expert put it, SDD means treating the spec as the blueprint
and the code as “a byproduct, an intermediate product between requirements and compiled
binaries” . Whether or not one goes so far as to treat the spec as the sole source of truth, SDD shifts
development to a higher level of abstraction: we evolve and maintain the specifications, and let AI
handle the low-level implementation details .
Proposed Solution: SpecLens AI
SpecLens AI is a development toolkit and methodology that implements spec-driven development in a
self-bootstrapping way. The goal of SpecLens is to ensure that specifications, code, and tests all remain
in sync automatically throughout the software lifecycle. It does so by integrating AI-based code
generation with iterative testing and refinement. The SpecLens workflow involves several key stages
(inspired by SDD best practices ):
Specification Phase: The process begins with a human-readable specification of the intended
feature or system. Developers write this spec in structured Markdown or a similar format,
capturing the requirements in detail – including user stories, functional and non-functional
requirements, constraints (“do not do X”), and acceptance criteria or example scenarios. This
document is effectively a contract that defines success in the user’s terms . If the project
is new, the team creates the spec from scratch; if it’s an existing system, SpecLens can bootstrap
an initial spec by analyzing the current code (similar to how the Tessl tool can reverse-engineer a
spec from code ). In either case, the spec is treated as the authoritative source of
requirements that the subsequent steps must follow.
Planning Phase: Given the spec, SpecLens uses an AI agent to generate a technical design and
plan. In this phase, the AI digests the high-level requirements and produces an architecture or
detailed approach for implementation. This could include suggesting module structures, data
models, interfaces, and a sequence of development tasks that satisfy the spec. The AI plan is
constrained by any context the developers provide (for example, existing architecture or
technology stack) – ensuring it respects integration points and patterns already in the codebase
. The output of this phase is a set of planned tasks or TODOs, each traceable to parts of the
specification (e.g. “Task 1 implements requirement 3.1: add SMS notification via Twilio”).
Developers review and refine this plan, in a human-in-the-loop step, to ensure it’s feasible and
aligned with their intentions before full coding begins.
Implementation & Testing Phase: SpecLens now proceeds to generate the actual code for each
task, alongside corresponding tests. This is where SpecLens AI’s dual capability shines. For each
planned task, an AI coding agent writes the necessary function, module, or component in the
target programming language. At the same time, because the spec includes explicit acceptance
criteria and example scenarios, SpecLens also generates unit tests or BDD-style test cases to
verify that the code meets the spec. In other words, test generation is built into the
implementation phase – the spec’s “Test Scenarios” (e.g. Given/When/Then examples
embedded in the spec) are converted into runnable tests automatically . This approach is
akin to having a built-in test-driven development loop: as each piece of code is created, there are
tests ready to validate it against the spec. The AI leverages its understanding of the spec to
produce tests that cover both happy paths and edge cases described in the requirements. For
instance, if the spec says “No SMS notifications should be sent during quiet hours (11 PM – 8 AM)
,” SpecLens will generate a test for that condition. These tests are not merely afterthoughts –
they are central to how SpecLens ensures correctness of the generated code.
Self-Bootstrapping Refinement Phase: What truly sets SpecLens AI apart is its continuous
validation and refinement loop. All the tests generated in the previous step are executed in a
Continuous Integration (CI) environment (using Docker containers to replicate the production
setup and dependencies consistently). This happens automatically as part of the SpecLens
pipeline. If all tests pass, it signals that the code implementation aligns with the spec’s
expectations. If any test fails, or if any spec acceptance criterion is not met, SpecLens treats it as
feedback for improvement. The failing tests and their outputs are fed back into the AI agent
(along with the spec) to debug and refine the code. The AI can suggest code fixes to address the
failure or, if the issue was an ambiguous or missing requirement, it can highlight that the spec
might need an update. This iterative loop continues – re-running tests after each AI revision –
until the code passes all the acceptance tests. In essence, SpecLens AI bootstraps the
development process by using its own outputs (test results) to improve the subsequent outputs
(code), converging on a correct solution. Throughout this cycle, the specification remains a living
document: if developers decide to change a requirement, they update the spec (e.g., adjust a
success criterion or add a new scenario), and SpecLens will regenerate or adapt the code and
tests accordingly. The spec thus stays in sync with the codebase at all times, embodying the
“spec-as-source” philosophy where the spec is the primary artifact being maintained over time .
The human team’s job shifts to refining specs and reviewing AI contributions, rather than writing
low-level code from scratch – a fundamentally spec-driven, supervisory role .
Beyond these core phases, SpecLens AI is designed to integrate seamlessly with modern development
tools and practices. The system will plug into version control and CI/CD pipelines (for example, as a
GitHub Action or a CI step in Jenkins/GitLab). A typical usage scenario would be: a developer writes or
updates a spec in the repository, then triggers SpecLens to generate/update the code and tests, which
are committed to a feature branch. The CI server then runs the SpecLens-generated tests (inside
Dockerized environments to ensure consistency across different machines). If the tests pass, the code
can be merged with confidence that it meets the specified requirements; if not, the team can invoke
SpecLens to attempt fixes or else manually intervene in either the spec or code. This tight integration
means SpecLens fits into agile workflows – it doesn’t replace the developer’s judgment, but accelerates
the routine work of writing boilerplate code and exhaustive tests. Importantly, SpecLens is languageagnostic to a large extent: since the spec is written in natural language and the AI model can code in
multiple programming languages, the same approach works for Python, Java, JavaScript, or most
popular languages (the underlying AI just needs the appropriate model or training for each language).
By using containerization (Docker), we ensure that running and testing the generated code works
across different tech stacks (e.g. a Docker image with the right runtime and libraries is used for a
Python project vs. a different image for a Node.js project). This makes SpecLens applicable to a wide
range of system engineering projects – from web applications to microservices and beyond. In
summary, SpecLens AI provides:
Spec-First Development: A requirement-specification-driven workflow that precedes and guides
all coding efforts .
Automated Code Synthesis: AI generation of code that directly implements the spec’s
described functionality, without developers writing the initial boilerplate.
Embedded Test Generation: Automatic creation of tests from spec scenarios and criteria,
ensuring each requirement is verifiable in code .
Continuous Integration Hook: Seamless execution of generated tests in a CI pipeline (using
Docker for consistent environments), providing immediate feedback on each change.
Self-Healing Loop: An iterative refinement mechanism where AI fixes its own mistakes based on
test outcomes, bootstrapping the development until spec and code converge.
Living Documentation: A spec that is continually updated and synchronized with the code – by
treating specs as the primary artifact, we maintain up-to-date documentation of system behavior
essentially for free .
Through these features, SpecLens AI aims to dramatically reduce the manual effort in programming
and testing, while increasing confidence that the software behaves exactly as intended by the
specification.
AI in Testing and Continuous Integration
A cornerstone of SpecLens AI is the integration of AI-driven testing into the development lifecycle.
Traditional automated test generation techniques (like symbolic execution or evolutionary algorithms)
showed promise in improving coverage, but often produced tests that were hard to maintain or lacked
human interpretability . Modern large language models (LLMs), on the other hand, have
demonstrated an impressive ability to understand code and generate readable, effective tests in natural
language style . Recent empirical studies indicate that LLMs (such as GPT-4) can automatically
generate unit tests that are syntactically correct, achieve high coverage, and follow testing best
practices – though challenges remain in fully covering complex logic and ensuring tests are
maintainable . In an experiment at DreamHost, an AI was able to write 273 unit tests in 3 days,
consistently reaching 96–100% code coverage and producing tests with proper mocking and assertion
patterns . These findings reinforce that AI can shoulder much of the tedious testing work, allowing
human engineers to focus on higher-level quality concerns.
SpecLens AI leverages this capability by making test generation an integral part of the spec-driven
workflow, rather than an afterthought. Each requirement in the spec is essentially a test waiting to be
implemented. By explicitly writing acceptance criteria and example scenarios in the spec (for
instance, a scenario describing an edge-case behavior), we give the AI clear targets for test cases. This
approach is supported by theory and practice: using scenario-oriented specs with a Given/When/Then
structure provides a common style that both humans and AI can understand . It also ensures
completeness – the spec covers the critical intended behaviors, and the AI-generated tests will check
those behaviors. The advantage of embedding tests in SDD is twofold: it validates the AI’s code and
validates the spec itself (if a requirement is unclear or contradictory, it will surface as a failing test,
prompting clarification). In effect, tests become the executable truth of the specification.
Continuous integration (CI) is the backbone that connects these ideas to real development practice. In a
CI-enabled project, every code change triggers automated build and test runs. SpecLens AI is built to
augment this process with AI-driven generation steps. For example, when a developer pushes a new
spec file or an updated spec to the repository, SpecLens can automatically generate the code and tests
in a new commit. Then the CI server (e.g., GitHub Actions, Jenkins) runs the tests in a Docker container.
This is similar to how some industry tools operate – Early (by StartEarly.ai) is an AI-powered solution that
deploys “a fleet of test code generation agents in your CI, creating quality working tests for every pull
request” . Such tools underscore the feasibility of our approach: AI-generated tests can indeed
be integrated into CI/CD to catch issues early on. By having SpecLens generate tests for each pull
request and update, we ensure consistent coverage and usage of testing across the project . If a
developer inadvertently introduces a change that violates the spec (say, a bug or an unhandled case),
the failing AI-generated test will immediately flag it, and even suggest a correction via the AI. This short
feedback loop prevents regression and keeps development aligned with requirements at all times,
which is a hallmark of good DevOps practice.
Moreover, by using containerization (Docker images) for running tests, SpecLens AI ensures that the
environment is controlled – tests will run the same locally and in CI, avoiding “it works on my machine”
problems. Docker also enables SpecLens to package any language-specific dependencies the AIgenerated code might need, which is crucial when the AI introduces new libraries or frameworks in the
implementation. The end result is a robust pipeline: write spec → generate code/tests → run tests →
get immediate feedback. This pipeline embodies the idea that “code is the last-mile approach” and the
real work is done at the spec level . It aligns with the observation that in BDD and spec-driven
practices, specs and tests go hand-in-hand supported by CI mechanisms . By automating both code
and test writing, SpecLens AI maximizes development velocity while safeguarding quality.
In summary, SpecLens uses AI in testing not just to save time, but to elevate the role of testing in
development. Tests are no longer a separate manual task – they are co-authored by the AI from the
spec and continuously verify the intent of the software. This continuous verification loop, powered by
CI, is what makes SpecLens “self-bootstrapping”: the tool constantly checks its work and improves it. It
ensures that rapid AI-driven coding doesn’t devolve into a “code quality crisis” of fragile code ,
because every step is validated by an equivalent AI-driven test. This approach is rooted in the
fundamental principle of software engineering that feedback is crucial – by getting feedback from tests
at each iteration, the AI and the developers can correct course immediately. Thus, AI in testing and CI is
not just an add-on for SpecLens, but a core pillar that transforms spec-driven development from a
theoretical idea into a practical, reliable engineering process.
Unique Contribution and Related Work
The concept of spec-driven development is very new, and a few pioneering tools have begun exploring
it, each with their own spin. SpecLens AI distinguishes itself by unifying several critical aspects –
persistent specifications, code generation, and automated testing – into one cohesive loop. To highlight
our unique contribution, it’s useful to compare with some related approaches:
GitHub Spec-Kit: Spec-Kit (an open-source toolkit by GitHub) provides an SDD workflow by
setting up files and templates for specs, plans, and tasks in a repository . It uses a CLI and
special prompts (like VS Code slash commands) to guide an AI through the phases of spec →
plan → tasks. However, Spec-Kit’s philosophy treats specs as ephemeral. It creates a new git
branch for each spec and seems to envision the spec document being used only for that
feature’s development, not maintained long-term . In other words, it’s spec-first but not
necessarily spec-anchored – once the feature is merged, the spec’s role diminishes. SpecLens
departs from this by making specs living artifacts that remain tied to the code. Every SpecLens
spec is meant to evolve with the software and stay relevant throughout the software’s life (more
akin to Tessl’s spec-as-source approach, below). Additionally, while Spec-Kit does include
checklists and even a “constitution” for coding guidelines , it doesn’t emphasize test
generation or automatic validation; human developers still must verify the AI’s output. SpecLens
fills that gap by baking verification into the cycle, reducing the review burden on developers.
Amazon Kiro: Kiro (from Amazon) is another early SDD tool that opts for simplicity – it guides
the developer through writing three Markdown documents: requirements, design, and tasks
. Kiro’s workflow is more lightweight in file structure, which makes it easier to grasp, and it
uses the spec to direct an AI coding assistant in a VS Code environment. The downside noted by
early users is that even this lighter workflow can be overkill for small changes: asking Kiro’s AI to
fix a minor bug resulted in a verbose spec with multiple user stories and dozens of acceptance
criteria, far more than a human would write for such a trivial fix . This indicates a
flexibility issue – current SDD tools struggle to scale down to tiny tasks. SpecLens AI is designed
with adaptability in mind. Our approach will allow developers to calibrate the level of detail
based on the problem at hand. If a task is minor, one could either skip the full SpecLens cycle or
use a minimal spec (and the AI would generate minimal code and tests accordingly). If the task is
major, the full spec and multi-step workflow would apply. By adjusting to the “size and clarity of
the problem” (an open question for SDD noted by Thoughtworks researchers ), SpecLens
aims to be generally applicable in real-world development – something prior tools have not yet
achieved .
Tessl: Tessl is a framework that explicitly aspires to spec-anchored and spec-as-source
development. It treats specs as the primary artifacts and keeps them in sync with code
generation. For example, Tessl can generate code files from a spec (in one experiment, a
.spec.md file was transformed into a .js implementation) and even insert a comment at
the top of generated code indicating it was generated from a specific spec . It also
explores round-trip engineering: a CLI command can take an existing code file and produce a
draft spec for it . This is very much aligned with SpecLens’s philosophy of treating specs and
code interchangeably, with the spec being the single source of truth. However, Tessl is still in
private beta (as of late 2025) and its exact capabilities are evolving . Our project can be
seen as complementary to Tessl’s vision but with a stronger emphasis on automation and
testing. Tessl provides the framework to manage spec-code pairs, but it doesn’t explicitly
describe an automated testing loop. SpecLens brings in the idea that every spec should be
immediately testable and tested. In other words, we don’t just synchronize spec and code; we
also verify the code against the spec continuously. This closes a critical gap – ensuring the
generated code is not only present, but correct. Additionally, because SpecLens will integrate
with CI, it naturally fits into a team’s existing DevOps process, whereas a specialized framework
like Tessl might require teams to adopt a new workflow entirely. SpecLens aims to meet
developers where they are (in GitHub, in CI, writing Markdown and code) and enhance their
process with AI, rather than forcing a totally new ecosystem.
Academic and Industry Research: Beyond these tools, there is broader research inspiring
SpecLens. The idea of self-bootstrapping code generation has appeared in academic contexts, such
as iteratively improving a model’s output by verification or formal checks (e.g., AlphaVerus which
bootstraps a code generator with formal verification steps). Similarly, the AI/DevOps community
is exploring “self-healing” pipelines where AI can detect and fix build or test issues automatically.
SpecLens is informed by these trends, but our focus is specifically on spec-driven software
development. We combine the proven concept of writing good specifications (something software
engineering textbooks have advocated for decades) with the latest AI capabilities to interpret
specs and generate software. By doing so, we address the often-cited disconnect between
requirements and implementation. As Liu Shangqi from Thoughtworks noted, “manipulating
computers with natural language that represents business has always been the holy grail of software
development” – previous attempts (like model-driven development with UML diagrams) fell
short due to complexity and inflexibility . Now, with LLMs, we have a chance to realize this
vision using flexible natural language specs instead of rigid formal models . SpecLens’s
uniqueness is in how it capitalizes on this moment: we embrace natural language for ease of
use, but we impose enough structure and automation (through templates, scenario syntax, CI
enforcement) to avoid the pitfalls of ambiguity and nondeterminism.
In conclusion of related work, while tools like Spec-Kit and Kiro established the viability of AI-assisted
spec-first coding, and Tessl hints at the future of spec-code synchronization, SpecLens AI pushes the
envelope by ensuring end-to-end traceability and correctness in an AI coding pipeline. We don’t just
generate code from specs – we generate tests from specs, run them, and have the AI self-correct based
on them. This tightly knit feedback loop is our key innovation. It directly tackles the concern that
dumping more specifications on developers could create “review overload” with little benefit . With
SpecLens, the spec is immediately turned into working code and verified behavior, so the payoff for
writing a spec is tangible and immediate (fewer manual corrections, and a working feature with full test
coverage) . By combining ideas from multiple domains, our project aims to deliver a tool that not
only is unique academically but also highly practical for software teams.
Conclusion
SpecLens AI – Self-Bootstrapping Spec-Driven Development is a forward-looking project at the
intersection of software engineering and artificial intelligence. It proposes a solution where writing a
clear specification isn’t just documentation – it is the starting point of an autonomous development
cycle that produces tested, reliable software. This project, undertaken as part of a bachelor’s degree in
System Engineering, not only leverages cutting-edge AI techniques but also reinforces core engineering
principles: requirement clarity, iterative refinement, and rigorous testing. By integrating with familiar
tools like GitHub, CI pipelines, and Docker containers, SpecLens AI will be readily usable in real
development environments. Our expected contributions include a prototype toolkit and methodology
that allow developers to: specify a feature in natural language, have the AI implement that feature in
code, and automatically verify it against the specification – with minimal human intervention aside
from providing guidance and review. We anticipate that SpecLens AI can dramatically accelerate
development (similar to how AI copilots speed up coding) while simultaneously improving quality (by
catching issues early via AI-generated tests). If successful, SpecLens AI will demonstrate a unique
synergy between human insight and machine automation: the human provides the “what” and “why” in
the spec, and the AI figures out the “how,” continuously checking its work. This could lead to more
consistent and maintainable software, as each change begins and ends with the specification. In
summary, SpecLens AI aims to deliver a spec-driven development assistant that acts as a tireless
junior developer and tester, turning our specifications into reality. By doing so, it highlights a promising
path for the future of software development – one where clarity of intention is king, and the grind of
coding and testing is largely handled by AI under the careful lens of human supervision.
Sources:
Böckeler, B. (2025). Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl.
MartinFowler.com
Shangqi, L. (2025). Spec-driven development – Unpacking one of 2025’s key new AI-assisted
engineering practices. Thoughtworks Insights
Zencoder AI Docs. A Practical Guide to Spec-Driven Development (example SDD workflow
and benefits)
Naszcyniec, R. (2025). How spec-driven development improves AI coding quality. Red Hat Developer
Blog
DreamHost Tech Blog (2025). How We Created 273 Unit Tests in 3 Days Without Writing a Single Line
of Code (AI-driven testing case study)
StartEarly.ai. Early – AI-Powered Test Generation Platform (product showcasing CI-integrated AI
test generation)
Thoughtworks (2025). Exploring GenAI for Dev – Anchoring AI to a Reference Application
(discussing challenges in AI code generation and spec overload)
Tessl Documentation (2025). Tessl Framework – Private Beta Overview (illustrating spec-assource approach)
GitHub (2025). Spec-Kit Open Source Toolkit (workflow and limitations of spec-first approach)
Amazon (2025). Kiro AI Assistant – Spec-Driven Workflow (noting verbosity issues in practice)
Yang, L. et al. (2024). An Empirical Study of Unit Test Generation with Large Language Models (arXiv
preprint)
A Practical Guide to Spec-Driven Development - Zencoder
Docs
https://docs.zencoder.ai/user-guides/tutorials/spec-driven-development-guide

How spec-driven development improves AI coding quality | Red Hat Developer
https://developers.redhat.com/articles/2025/10/22/how-spec-driven-development-improves-ai-coding-quality
Understanding Spec-Driven-Development: Kiro, spec-kit, and Tessl
https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
Spec-driven development. Unpacking one of 2025’s key new… | by Thoughtworks |
Dec, 2025 | Medium
https://thoughtworks.medium.com/spec-driven-development-d85995a81387
An Empirical Study of Unit Test Generation with Large Language Models.
https://arxiv.org/html/2406.18181v1
How We Created 273 Unit Tests in 3 Days Without Writing a Single Line of Code - DreamHost
https://www.dreamhost.com/news/announcements/how-we-created-273-unit-tests-in-3-days-without-writing-a-single-lineof-code/
Automated, High-Quality Unit Tests and Code Coverage for Your Pull Requests

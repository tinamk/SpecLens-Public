import { useRef, useState } from "react";
import { Modal } from "./Modal";
import "./styles/app.css";

export default function App() {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="app-shell">
      <button ref={openerRef} onClick={() => setOpen(true)}>
        Open modal
      </button>

      <Modal
        open={open}
        title="Example modal"
        onClose={() => setOpen(false)}
        returnFocusRef={openerRef}
      >
        <p>Modal content</p>
        <button data-modal>First focusable</button>
        <button data-modal>Second focusable</button>
      </Modal>
    </div>
  );
}

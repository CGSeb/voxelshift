import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface ModalSelectProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function ModalSelect<T extends string>({ label, value, options, disabled, onChange }: ModalSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (open) shellRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="planner-select-shell" ref={shellRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          event.preventDefault();
          close();
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || disabled) return;
        event.preventDefault();
        if (!open) { setOpen(true); return; }
        const items = Array.from(shellRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
        const current = items.findIndex((item) => item === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <button ref={triggerRef} type="button" disabled={disabled}
        className={`release-config-input planner-select-trigger${open ? " planner-select-trigger-open" : ""}`}
        aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}>
        <span className="planner-select-value">{options.find((option) => option.value === value)?.label}</span>
        <ChevronDown className={`planner-select-chevron${open ? " planner-select-chevron-open" : ""}`} size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open ? (
        <div id={menuId} className="planner-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button key={option.value} type="button" role="option" tabIndex={-1}
              className={`planner-select-option${option.value === value ? " planner-select-option-active" : ""}`}
              aria-selected={option.value === value}
              onClick={() => { onChange(option.value); close(); }}>
              <span>{option.label}</span>
              {option.value === value ? <Check className="planner-select-check" size={16} strokeWidth={2.2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

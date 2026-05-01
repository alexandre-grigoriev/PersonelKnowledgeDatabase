import { useEffect, useRef, useState } from "react";

export function TopSelect({
  imgSrc, icon, label, value, options, onChange,
}: {
  imgSrc?:  string;
  icon?:    React.ReactNode;
  label?:   string;
  value:    string;
  options:  { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.id === value);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="topSelectWrap" ref={wrapRef}>
      <button className="topSelectBtn" onClick={() => setOpen((v) => !v)}>
        {imgSrc
          ? <img src={imgSrc} alt="" className="topSelectImg" />
          : icon
          ? <div className="topSelectIcon">{icon}</div>
          : null}
        {label && <div className="topSelectLabel">{label}:</div>}
        <div className="topSelectValue">{selected?.name ?? "Select..."}</div>
        {/* ChevronDown inline — no lucide dependency */}
        <svg className="topSelectChevron" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="topSelectDropdown">
          {options.map((o) => (
            <button
              key={o.id}
              className={`topSelectDropdownItem${o.id === value ? " topSelectDropdownItemActive" : ""}`}
              onClick={() => { onChange(o.id); setOpen(false); }}
            >
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

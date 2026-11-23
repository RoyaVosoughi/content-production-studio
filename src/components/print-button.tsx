"use client";

/** Opens the browser's print box, where the page can also be saved as a PDF. Hidden on paper. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="btn btn-quiet print:hidden" data-print>
      {label}
    </button>
  );
}

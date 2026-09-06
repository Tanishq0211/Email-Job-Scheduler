import { useRef, useState } from "react";
import { FileUp, FileText, X } from "lucide-react";
import { parseRecipientsFile, type CsvParseResult } from "../../lib/csv";

interface Props {
  result: CsvParseResult | null;
  onChange: (result: CsvParseResult | null) => void;
  onError: (message: string) => void;
}

export function CsvUploader({ result, onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File) {
    if (!/\.(csv|txt)$/i.test(file.name)) {
      onError("Please choose a .csv or .txt file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      onError("File is too large (max 5MB)");
      return;
    }
    setReading(true);
    try {
      onChange(await parseRecipientsFile(file));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not parse file");
    } finally {
      setReading(false);
    }
  }

  return (
    <div>
      {!result ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={`flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
            dragging ? "border-brand-500 bg-brand-50" : "border-slate-300 hover:border-brand-400 hover:bg-slate-50"
          }`}
        >
          <FileUp className="h-6 w-6 text-slate-400" />
          <span className="mt-2 text-sm font-medium text-slate-700">
            {reading ? "Parsing file…" : "Upload CSV or TXT"}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            Drag & drop or click — one email per row, or a name,email column pair
          </span>
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200">
                <FileText className="h-4.5 w-4.5 h-5 w-5 text-brand-600" />
              </span>
              <span className="text-sm font-medium text-slate-900">
                {result.fileName}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
              aria-label="Remove file"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="font-medium text-emerald-700">
              {result.valid.length} valid emails
            </span>
            {result.invalid.length > 0 && (
              <span className="text-red-600">{result.invalid.length} invalid</span>
            )}
            {result.duplicatesRemoved > 0 && (
              <span className="text-slate-500">
                {result.duplicatesRemoved} duplicates removed
              </span>
            )}
          </div>
          {result.invalid.length > 0 && (
            <p className="mt-2 max-h-20 overflow-y-auto text-xs text-red-500">
              Skipped: {result.invalid.slice(0, 20).join(", ")}
              {result.invalid.length > 20 ? "…" : ""}
            </p>
          )}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

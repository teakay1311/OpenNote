"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  CaseSensitive,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";

export interface FormatState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  block: string; // "h1" | "h2" | "h3" | "p" | "blockquote" ...
}

export interface FormatActions {
  setBlock: (tag: string) => void;
  toggleInline: (cmd: "bold" | "italic" | "underline" | "strikeThrough") => void;
  setList: (type: "bullet" | "number" | "dash") => void;
  setQuote: () => void;
  insertDivider: () => void;
  setTextColor: (color: string | null) => void;
  setHighlight: (color: string | null) => void;
}

const TEXT_COLORS = [
  "#d93025",
  "#e8710a",
  "#b08000",
  "#1e8e3e",
  "#9334e6",
  "#c2185b",
  "#5f6368",
  "#000000",
];

const BG_COLORS = [
  null,
  "#fce8e6",
  "#fef7e0",
  "#e6f4ea",
  "#e8f0fe",
  "#f3e8fd",
  "#fce4ec",
  "#f1f3f4",
];

function Swatches({
  colors,
  onPick,
  label,
}: {
  colors: (string | null)[];
  onPick: (c: string | null) => void;
  label: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <button
            key={i}
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "size-6 rounded-full border border-black/10 transition-transform hover:scale-110 dark:border-white/20",
              c === null && "flex items-center justify-center bg-black/5 text-[10px] font-bold text-muted-foreground dark:bg-white/10"
            )}
            style={c ? { backgroundColor: c } : undefined}
            onClick={() => onPick(c)}
            aria-label={c ? `Màu ${c}` : "Mặc định"}
          >
            {c === null ? "A" : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FormatPopover({
  state,
  actions,
  children,
}: {
  state: FormatState;
  actions: FormatActions;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        {/* Paragraph styles */}
        <div className="space-y-0.5">
          <BlockButton
            label="Tiêu đề"
            active={state.block === "h1"}
            className="text-xl font-bold"
            onClick={() => actions.setBlock("h1")}
          />
          <BlockButton
            label="Tiêu đề phụ"
            active={state.block === "h2"}
            className="text-base font-semibold"
            onClick={() => actions.setBlock("h2")}
          />
          <BlockButton
            label="Tiêu đề con"
            active={state.block === "h3"}
            className="text-sm font-semibold"
            onClick={() => actions.setBlock("h3")}
          />
          <BlockButton
            label="Nội dung"
            active={state.block === "p" || state.block === "div"}
            className="text-sm"
            onClick={() => actions.setBlock("p")}
          />
          <BlockButton
            label="Trích dẫn"
            active={state.block === "blockquote"}
            className="text-sm text-muted-foreground"
            italicQuote
            onClick={() => actions.setBlock("blockquote")}
          />
        </div>

        <div className="my-2.5 h-px bg-border" />

        {/* Inline styles */}
        <div className="flex items-center gap-1">
          <InlineButton
            active={state.bold}
            label="Đậm"
            onClick={() => actions.toggleInline("bold")}
          >
            <span className="text-base font-bold">B</span>
          </InlineButton>
          <InlineButton
            active={state.italic}
            label="Nghiêng"
            onClick={() => actions.toggleInline("italic")}
          >
            <span className="text-base italic">I</span>
          </InlineButton>
          <InlineButton
            active={state.underline}
            label="Gạch chân"
            onClick={() => actions.toggleInline("underline")}
          >
            <Underline className="size-4" />
          </InlineButton>
          <InlineButton
            active={state.strike}
            label="Gạch ngang"
            onClick={() => actions.toggleInline("strikeThrough")}
          >
            <Strikethrough className="size-4" />
          </InlineButton>
        </div>

        <div className="my-2.5 h-px bg-border" />

        {/* Lists */}
        <div className="flex items-center gap-1">
          <InlineButton label="Danh sách dấu đầu dòng" onClick={() => actions.setList("bullet")}>
            <List className="size-4" />
          </InlineButton>
          <InlineButton label="Danh sách gạch ngang" onClick={() => actions.setList("dash")}>
            <span className="text-base font-semibold">–</span>
          </InlineButton>
          <InlineButton label="Danh sách đánh số" onClick={() => actions.setList("number")}>
            <ListOrdered className="size-4" />
          </InlineButton>
          <InlineButton label="Trích dẫn" onClick={() => actions.setQuote()}>
            <Quote className="size-4" />
          </InlineButton>
          <InlineButton label="Đường kẻ" onClick={() => actions.insertDivider()}>
            <Minus className="size-4" />
          </InlineButton>
        </div>

        <div className="my-2.5 h-px bg-border" />

        {/* Colors */}
        <div className="space-y-2.5">
          <Swatches
            label="Màu chữ"
            colors={TEXT_COLORS}
            onPick={actions.setTextColor}
          />
          <Swatches
            label="Nền chữ"
            colors={BG_COLORS}
            onPick={actions.setHighlight}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BlockButton({
  label,
  active,
  className,
  italicQuote,
  onClick,
}: {
  label: string;
  active: boolean;
  className?: string;
  italicQuote?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/5",
        active && "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      )}
      onClick={onClick}
    >
      {italicQuote ? (
        <Quote className="size-4 shrink-0 opacity-60" />
      ) : (
        <CaseSensitive className="size-4 shrink-0 opacity-60" />
      )}
      <span className={cn("truncate", className)}>{label}</span>
    </button>
  );
}

function InlineButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/5",
        active && "bg-amber-500/20 text-amber-700 dark:text-amber-300"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

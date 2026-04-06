import clsx from "clsx";

interface Props {
  text: string;
  color?: string;
  className?: string;
}

export default function Badge({ text, color, className }: Props) {
  return (
    <span
      className={clsx(
        "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
        color ?? "text-zinc-400 bg-zinc-800",
        className,
      )}
    >
      {text}
    </span>
  );
}

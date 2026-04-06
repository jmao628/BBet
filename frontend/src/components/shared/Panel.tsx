import clsx from "clsx";
import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

export default function Panel({ title, children, className, headerRight }: Props) {
  return (
    <div className={clsx("bg-zinc-900 border border-zinc-800 rounded", className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">{title}</h3>
        {headerRight}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

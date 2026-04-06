import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Zap,
  FlaskConical,
  ShieldAlert,
  Activity,
  BarChart3,
} from "lucide-react";
import clsx from "clsx";

const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/dashboard", label: "Dashboard", icon: BarChart3 },
  { to: "/signals", label: "Signals", icon: Zap },
  { to: "/backtest", label: "Backtest", icon: FlaskConical },
  { to: "/risk", label: "Risk", icon: ShieldAlert },
  { to: "/system", label: "System", icon: Activity },
] as const;

export default function Layout() {
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 font-mono text-sm">
      {/* Sidebar */}
      <nav className="w-48 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-4 border-b border-zinc-800">
          <span className="text-xs tracking-widest text-zinc-500 uppercase">BPMDE</span>
          <h1 className="text-sm font-semibold text-zinc-200 mt-0.5">Terminal</h1>
        </div>
        <div className="flex-1 py-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 px-4 py-2 text-xs transition-colors",
                  isActive
                    ? "bg-zinc-800/60 text-zinc-100 border-r-2 border-green-500"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900",
                )
              }
            >
              <Icon size={14} />
              {label}
            </NavLink>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-zinc-800 text-[10px] text-zinc-600">
          v0.1 · NBA 2025-26
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

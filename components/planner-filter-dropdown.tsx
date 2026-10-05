"use client";
import { useId, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import type { Item } from "@/lib/model";
import {
  machineTier,
  machineVoltage,
  tierColors,
} from "@/lib/machine-selection";
import { MachineItemTooltip } from "./machine-selector";

export function PlannerFilterDropdown({
  label,
  emptyLabel,
  items,
  selected,
  onChange,
  loading = false,
  singleSelect = false,
  searchable = !singleSelect,
}: {
  label: string;
  emptyLabel: string;
  items: { id: string; name: string; machine?: Item; disabled?: boolean }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  singleSelect?: boolean;
  searchable?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [query, setQuery] = useState("");
  const matches = items.filter((item) =>
    `${item.name.replace(/§./g, "")} ${item.machine?.mod ?? ""} ${item.machine ? (machineTier(item.machine) ?? "") : ""}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const chosen = items.filter((item) => selected.includes(item.id));
  return (
    <div className="planner-filter">
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="menu"
        disabled={loading}
        onClick={(event) => {
          const popup = menu.current;
          if (!popup) return;
          if (popup.matches(":popover-open")) {
            popup.hidePopover();
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const width = Math.min(bounds.width, window.innerWidth - 16);
          popup.style.width = `${width}px`;
          popup.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
          popup.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 360))}px`;
          setQuery("");
          popup.showPopover();
          if (searchable) input.current?.focus();
          else popup.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
        }}
      >
        <span id={`${id}-value`}>
          {loading
            ? "Loading…"
            : selected.length
              ? singleSelect ? chosen[0]?.name.replace(/§./g, "") ?? emptyLabel : `${selected.length} selected${chosen.length === 1 ? `: ${chosen[0].name.replace(/§./g, "")}` : ""}`
              : emptyLabel}
        </span>
        <ChevronDown size={16} />
      </button>
      <div
        ref={menu}
        popover="auto"
        role="menu"
        aria-label={label}
        className="machine-selector-menu planner-filter-menu nowheel"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            menu.current?.hidePopover();
          }
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            const buttons = [
              ...menu.current!.querySelectorAll<HTMLButtonElement>(
                '[role="menuitemcheckbox"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
              ),
            ];
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
                buttons.length
            ]?.focus();
          }
        }}
      >
        {searchable && <div className="planner-filter-search">
          <input
            ref={input}
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="planner-filter-clear"
            aria-label={singleSelect ? `Clear ${label.toLowerCase()} search` : `Clear selected ${label.toLowerCase()}`}
            title={singleSelect ? "Clear search" : "Clear selection"}
            disabled={singleSelect ? !query : !selected.length}
            onClick={() => singleSelect ? setQuery('') : onChange([])}
          >
            <X size={14} />
          </button>
        </div>}
        {matches.map(({ id, name, machine, disabled }) => {
          const tier = machine && machineTier(machine),
            voltage = machine && machineVoltage(machine);
          return (
            <button
              type="button"
              role={singleSelect ? "menuitemradio" : "menuitemcheckbox"}
              disabled={disabled}
              aria-checked={selected.includes(id)}
              key={id}
              onClick={() => {
                if (singleSelect) {
                  onChange([id]);
                  menu.current?.hidePopover();
                  return;
                }
                onChange(
                  selected.includes(id)
                    ? selected.filter((value) => value !== id)
                    : [...selected, id],
                );
              }}
            >
              {machine && (
                <span className="machine-option-icon">
                  {machine.image ? <img src={machine.image} alt="" /> : "?"}
                  <MachineItemTooltip item={machine} />
                </span>
              )}
              <span className="machine-option-description">
                <span>{name.replace(/§./g, "")}</span>
                {voltage !== undefined && (
                  <span className="machine-option-voltage">
                    Voltage IN: {voltage.toLocaleString("en-US")}
                    {tier && (
                      <>
                        {" "}
                        (
                        <span
                          style={{
                            color: tierColors[tier],
                            textShadow:
                              tier === "EV" || tier === "LV"
                                ? "0.5px 0.5px #333"
                                : undefined,
                          }}
                        >
                          {tier}
                        </span>
                        )
                      </>
                    )}
                  </span>
                )}
              </span>
              <Check
                className="planner-filter-check"
                size={16}
                style={{
                  visibility: selected.includes(id) ? "visible" : "hidden",
                }}
              />
            </button>
          );
        })}
        {!matches.length && <p>No matches</p>}
      </div>
    </div>
  );
}

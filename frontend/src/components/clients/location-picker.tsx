"use client";

import { useEffect, useRef, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Globe2, MapPin, X } from "lucide-react";

import { inferLocationKind, searchLocations, type LocationOption } from "@/lib/locations";

const SEARCH_DEBOUNCE_MS = 150;

export function LocationPicker({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [inputValue, setInputValue] = useState("");
  const [items, setItems] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const latestQuery = useRef<string | null>(null);

  useEffect(() => {
    latestQuery.current = inputValue;
    const timer = setTimeout(() => {
      searchLocations(inputValue).then((results) => {
        if (latestQuery.current === inputValue) {
          setItems(results);
          setLoading(false);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const handleInputValueChange = (next: string) => {
    setLoading(true);
    setInputValue(next);
  };

  const selectedOptions: LocationOption[] = value.map((v) => ({ value: v, kind: inferLocationKind(v) }));

  return (
    <Combobox.Root<LocationOption, true>
      multiple
      items={items}
      filter={null}
      value={selectedOptions}
      onValueChange={(next) => onChange(next.map((o) => o.value))}
      inputValue={inputValue}
      onInputValueChange={handleInputValueChange}
      itemToStringLabel={(o) => o.value}
      itemToStringValue={(o) => o.value}
      isItemEqualToValue={(a, b) => a.value === b.value}
    >
      <Combobox.Chips
        className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      >
        {value.map((location) => (
          <Combobox.Chip
            key={location}
            className="flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground"
          >
            {inferLocationKind(location) === "country" ? (
              <Globe2 className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <MapPin className="size-3 shrink-0 text-muted-foreground" />
            )}
            {location}
            <Combobox.ChipRemove
              className="rounded-sm hover:bg-foreground/10"
              onClick={() => onChange(value.filter((v) => v !== location))}
            >
              <X className="size-3" />
            </Combobox.ChipRemove>
          </Combobox.Chip>
        ))}
        <Combobox.Input
          id={id}
          placeholder={value.length ? "Add another…" : "Search a city or country…"}
          className="h-6 min-w-32 flex-1 border-0 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </Combobox.Chips>

      <Combobox.Portal>
        <Combobox.Positioner className="isolate z-50 outline-none" sideOffset={4}>
          <Combobox.Popup className="max-h-64 w-(--anchor-width) min-w-56 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            <Combobox.Empty className="px-2 py-1.5 text-sm text-muted-foreground">
              {loading ? "Searching…" : "No matching city or country"}
            </Combobox.Empty>
            <Combobox.List>
              {(item: LocationOption) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="flex cursor-default items-center gap-1.5 rounded-md px-2 py-1.5 outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-selected:font-medium"
                >
                  {item.kind === "country" ? (
                    <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {item.value}
                  {item.kind === "country" && (
                    <span className="ml-auto text-xs text-muted-foreground">Whole country</span>
                  )}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

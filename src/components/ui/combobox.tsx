"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { foldDigits } from "@/lib/digits.ts";
import type { FormOption } from "@/lib/lookups.ts";
import { cn } from "@/lib/utils";

function normalizeSearch(text: string): string {
  /* The letter folds match `app.fold_text`'s searchable alphabet; the digit
     fold is the shared one — a query typed on either keyboard finds the row. */
  return foldDigits(text).replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").trim().toLowerCase();
}

export interface ComboboxProps {
  id?: string | undefined;
  name: string;
  value?: string | undefined;
  defaultValue?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  onInputChange?: ((value: string) => void) | undefined;
  options: FormOption[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  allowCustom?: boolean | undefined;
  className?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-invalid"?: boolean | undefined;
  "aria-describedby"?: string | undefined;
}

export function Combobox({
  id: explicitId,
  name,
  value: controlledValue,
  defaultValue = "",
  onChange,
  onInputChange,
  options,
  placeholder,
  disabled = false,
  required = false,
  allowCustom = true,
  className,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedby,
}: ComboboxProps) {
  const t = useTranslations("common");
  const fallbackId = useId();
  const id = explicitId ?? fallbackId;
  /* The owned listbox's id, and its options' — what `aria-controls` and
   `aria-activedescendant` name so the input and the list read as one control. */
  const listboxId = `${id}-listbox`;

  const [internalValue, setInternalValue] = useState(controlledValue ?? defaultValue);
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "bottom" | "top";
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Synchronize controlled value
  useEffect(() => {
    if (controlledValue !== undefined) {
      setInternalValue(controlledValue);
    }
  }, [controlledValue]);

  // Determine current matching option
  const selectedOption = useMemo(() => {
    if (!internalValue) return null;
    return options.find((opt) => opt.value === internalValue) ?? null;
  }, [options, internalValue]);

  // Synchronize input display text when not actively typing
  useEffect(() => {
    if (!isTyping) {
      if (!internalValue) {
        setInputText("");
      } else {
        setInputText(selectedOption?.label ?? internalValue);
      }
    }
  }, [internalValue, selectedOption, isTyping]);

  // Filter options based on typed input
  const filteredOptions = useMemo(() => {
    if (!isTyping || !inputText.trim()) return options;
    const query = normalizeSearch(inputText);
    return options.filter((opt) => {
      const normLabel = normalizeSearch(opt.label);
      const normValue = normalizeSearch(opt.value);
      return normLabel.includes(query) || normValue.includes(query);
    });
  }, [options, inputText, isTyping]);

  // Calculate floating portal coordinates
  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dropdownHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeTop = spaceBelow < dropdownHeight && rect.top > dropdownHeight;

    setDropdownRect({
      top: placeTop ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      placement: placeTop ? "top" : "bottom",
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  // Click outside listener for trigger + portalled dropdown
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setIsTyping(false);
        if (!allowCustom) {
          setInputText(selectedOption?.label ?? (internalValue ? internalValue : ""));
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open, allowCustom, selectedOption, internalValue]);

  const handleSelect = (optionValue: string) => {
    const picked = options.find((o) => o.value === optionValue);
    setInternalValue(optionValue);
    setInputText(picked?.label ?? optionValue);
    setIsTyping(false);
    setOpen(false);
    onChange?.(optionValue);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInternalValue("");
    setInputText("");
    setIsTyping(false);
    onChange?.("");
    onInputChange?.("");
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextText = e.target.value;
    setInputText(nextText);
    setIsTyping(true);
    onInputChange?.(nextText);
    if (!open) setOpen(true);
    setHighlightedIndex(0);

    if (allowCustom) {
      setInternalValue(nextText);
      onChange?.(nextText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setHighlightedIndex(0);
      } else {
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : prev));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === "Enter") {
      if (open && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
        const targetOption = filteredOptions[highlightedIndex];
        if (targetOption) {
          e.preventDefault();
          handleSelect(targetOption.value);
        }
      }
    } else if (e.key === "Escape") {
      /*
       * Escape closes the dropdown and stops there.
       *
       * Unhandled, the keypress kept travelling: inside any dialog the same
       * Escape dismissed the combobox *and* the dialog holding it, throwing
       * away whatever the person had typed into the form. When the dropdown
       * was open, Escape means "close the dropdown" and nothing else.
       */
      if (open) {
        e.preventDefault();
        e.stopPropagation();
      }
      setOpen(false);
      setIsTyping(false);
    }
  };

  const handleInputClick = () => {
    if (!disabled && !open) {
      setOpen(true);
    }
  };

  const handleInputFocus = () => {
    if (!disabled && !open) {
      setOpen(true);
    }
  };

  const handleToggleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    if (open) {
      setOpen(false);
      setIsTyping(false);
    } else {
      setOpen(true);
      inputRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", open && "z-50", className)}>
      <input type="hidden" name={name} value={internalValue} />

      {/* Input trigger box */}
      <div
        className={cn(
          "relative flex w-full items-center rounded-lg border border-input bg-card py-1.5 pe-8 ps-3 text-start text-xs shadow-2xs transition-all hover:bg-card/90",
          open && "border-primary ring-2 ring-primary/20",
          disabled && "cursor-not-allowed opacity-50 bg-muted",
          ariaInvalid &&
            "border-destructive focus-within:border-destructive focus-within:ring-destructive/20",
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onClick={handleInputClick}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? t("searchOrSelect")}
          disabled={disabled}
          required={required && !internalValue}
          aria-label={ariaLabel ?? placeholder ?? t("searchOrSelect")}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          /*
           * The full ARIA combobox pattern.
           *
           * This input *is* the combobox: it announces what it opens, what is
           * expanded, which listbox it owns and which option a keyboard user
           * is on. Without these attributes a screen reader announced a bare
           * textbox followed by an unlabeled floating list — the control was
           * usable by sight alone, which is another way of saying not usable
           * in an office where somebody's colleague cannot see it.
           */
          role="combobox"
          aria-expanded={open && !disabled}
          aria-controls={open && !disabled ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && highlightedIndex >= 0 ? `${listboxId}-${highlightedIndex}` : undefined
          }
          className="w-full bg-transparent text-foreground placeholder:text-muted-foreground outline-none text-xs"
        />

        <div className="absolute inset-y-0 end-2 flex items-center gap-1">
          {internalValue && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="flex size-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
              /* Named apart from the date picker's «پاک کردن»: two kinds of
                 control on one form clearing different things must not share
                 one accessible name — a screen reader user (and any test)
                 asking for «پاک کردن» means a specific field's clear. */
              aria-label={t("clearSelection")}
            >
              <X className="size-3" />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={handleToggleClick}
            aria-label={ariaLabel ?? placeholder ?? t("searchOrSelect")}
            className="flex items-center justify-center p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {/* Portalled dropdown list (never clipped by any parent container) */}
      {open &&
        !disabled &&
        dropdownRect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? placeholder ?? t("searchOrSelect")}
            aria-live="polite"
            aria-relevant="additions text"
            /* `aria-live` because the list *changes* as the person types: a
               screen reader that announced only the static listbox never said
               «three matches» or «nothing found», and a user who cannot see
               the dropdown was typing into silence. Polite, so it never
               interrupts the echo of the character just typed. */
            style={{
              position: "fixed",
              top: dropdownRect.placement === "top" ? undefined : dropdownRect.top,
              bottom:
                dropdownRect.placement === "top"
                  ? `${window.innerHeight - dropdownRect.top}px`
                  : undefined,
              left: dropdownRect.left,
              width: dropdownRect.width,
              zIndex: 99999,
            }}
            className="max-h-60 overflow-y-auto rounded-xl border border-border/80 bg-popover/95 p-1 text-xs text-popover-foreground shadow-2xl backdrop-blur-md ring-1 ring-border/50 animate-in fade-in-0 zoom-in-95 duration-100"
          >
            {filteredOptions.length === 0 ? (
              allowCustom && inputText.trim() ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    const customValue = inputText.trim();
                    setInternalValue(customValue);
                    setInputText(customValue);
                    setIsTyping(false);
                    setOpen(false);
                    onChange?.(customValue);
                  }}
                  className="flex w-full items-center rounded-lg bg-primary/10 px-2.5 py-2 text-start text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  {t("useCustomValue", { value: inputText.trim() })}
                </button>
              ) : (
                <div className="py-3 px-3 text-center text-xs text-muted-foreground">
                  {t("noResultsFound")}
                </div>
              )
            ) : (
              filteredOptions.map((option, idx) => {
                const isSelected = option.value === internalValue;
                const isHighlighted = idx === highlightedIndex;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    id={`${listboxId}-${idx}`}
                    aria-selected={isSelected}
                    onClick={() => handleSelect(option.value)}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-start text-xs transition-colors cursor-pointer",
                      isSelected
                        ? "bg-primary/15 font-bold text-primary"
                        : isHighlighted
                          ? "bg-muted text-foreground"
                          : "text-foreground/90 hover:bg-muted/70",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check className="size-3.5 text-primary shrink-0 ms-2" />}
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

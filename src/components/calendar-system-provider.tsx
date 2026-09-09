"use client";

import { createContext, type ReactNode, useContext } from "react";

export type CalendarSystem = "jalali" | "gregorian";

const CalendarSystemContext = createContext<CalendarSystem>("jalali");

export function CalendarSystemProvider({
  calendarSystem,
  children,
}: {
  calendarSystem: CalendarSystem;
  children: ReactNode;
}) {
  return (
    <CalendarSystemContext.Provider value={calendarSystem}>
      {children}
    </CalendarSystemContext.Provider>
  );
}

export function useCalendarSystem(): CalendarSystem {
  return useContext(CalendarSystemContext);
}

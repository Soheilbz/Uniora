"use server";

import { issueCertificates as issueCertificatesUseCase } from "./application/certificates.ts";
import {
  importWorkshops as importWorkshopsUseCase,
  planWorkshopImport as planWorkshopImportUseCase,
  rollbackWorkshopImport as rollbackWorkshopImportUseCase,
} from "./application/imports.ts";
import {
  setAttendance as setAttendanceUseCase,
  transitionWorkshopRegistration as transitionWorkshopRegistrationUseCase,
} from "./application/participation.ts";
import {
  deleteWorkshops as deleteWorkshopsUseCase,
  saveWorkshop as saveWorkshopUseCase,
} from "./application/use-cases.ts";

export async function saveWorkshop(...args: Parameters<typeof saveWorkshopUseCase>) {
  return saveWorkshopUseCase(...args);
}

export async function deleteWorkshops(...args: Parameters<typeof deleteWorkshopsUseCase>) {
  return deleteWorkshopsUseCase(...args);
}

export async function setAttendance(...args: Parameters<typeof setAttendanceUseCase>) {
  return setAttendanceUseCase(...args);
}

export async function transitionWorkshopRegistration(
  ...args: Parameters<typeof transitionWorkshopRegistrationUseCase>
) {
  return transitionWorkshopRegistrationUseCase(...args);
}

export async function issueCertificates(...args: Parameters<typeof issueCertificatesUseCase>) {
  return issueCertificatesUseCase(...args);
}

export async function planWorkshopImport(...args: Parameters<typeof planWorkshopImportUseCase>) {
  return planWorkshopImportUseCase(...args);
}

export async function importWorkshops(...args: Parameters<typeof importWorkshopsUseCase>) {
  return importWorkshopsUseCase(...args);
}

export async function rollbackWorkshopImport(
  ...args: Parameters<typeof rollbackWorkshopImportUseCase>
) {
  return rollbackWorkshopImportUseCase(...args);
}

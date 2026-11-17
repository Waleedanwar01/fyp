import { api, extractErrorMessage } from "@/lib/api";

export type ExportPdfOptions = {
  clientId: string;
  clientName: string;
  since?: string | null;
  until?: string | null;
};

/**
 * Fetches the generated PDF as a Blob and Object URL for live in-browser preview.
 */
export async function fetchClientPdfBlob({
  clientId,
  since,
  until,
}: {
  clientId: string;
  since?: string | null;
  until?: string | null;
}): Promise<{ blob: Blob; blobUrl: string }> {
  const queryParams = new URLSearchParams();
  if (since) queryParams.set("since", since);
  if (until) queryParams.set("until", until);
  const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : "";

  const response = await api.get(`/clients/${clientId}/pdf-report/${queryStr}`, {
    responseType: "blob",
  });

  const blob = new Blob([response.data], { type: "application/pdf" });
  const blobUrl = window.URL.createObjectURL(blob);
  return { blob, blobUrl };
}

/**
 * Downloads a PDF Blob with a clean filename.
 */
export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

/**
 * Opens a PDF Blob in a new browser window/tab for full-screen inspection/printing.
 */
export function openPdfBlobInNewTab(blobUrl: string): void {
  window.open(blobUrl, "_blank", "noopener,noreferrer");
}

/**
 * Downloads the server-generated white-label PDF report for a client workspace.
 */
export async function downloadClientPdfReport({
  clientId,
  clientName,
  since,
  until,
}: ExportPdfOptions): Promise<void> {
  const { blob } = await fetchClientPdfBlob({ clientId, since, until });
  const cleanName = clientName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "_");
  
  const dateSuffix = since ? `_${since.replace(/-/g, "")}${until ? `_to_${until.replace(/-/g, "")}` : ""}` : "";
  downloadPdfBlob(blob, `${cleanName}_ai_visibility_report${dateSuffix}.pdf`);
}

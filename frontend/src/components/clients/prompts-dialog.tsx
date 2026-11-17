"use client";

import {
  ClientPromptsManager,
  type PromptRecord,
} from "@/components/clients/client-prompts-manager";
import { Dialog, DialogContent } from "@/components/ui/dialog";

export { type PromptRecord } from "@/components/clients/client-prompts-manager";

export function PromptsDialog({
  clientId,
  clientName,
  prompts,
  defaultLocationTags = [],
  defaultServiceTags = [],
  onClose,
  onChanged,
}: {
  clientId: string;
  clientName: string;
  prompts: PromptRecord[];
  defaultLocationTags?: string[];
  defaultServiceTags?: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[94vh] w-full max-w-5xl overflow-y-auto p-0 sm:max-w-5xl border-none bg-transparent shadow-none">
        <ClientPromptsManager
          clientId={clientId}
          clientName={clientName}
          prompts={prompts}
          defaultLocationTags={defaultLocationTags}
          defaultServiceTags={defaultServiceTags}
          onChanged={onChanged}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

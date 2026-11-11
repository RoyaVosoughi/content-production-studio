"use client";

import { useState } from "react";
import { removePieceAction } from "@/app/actions";
import type { PublishState } from "@/lib/content";
import type { Strings } from "@/lib/i18n";
import type { UiLanguage } from "@/lib/language";
import { platformLabel, type Platform } from "@/lib/platforms";
import { ActionForm, SubmitButton } from "./action-form";

/**
 * The last thing under each post: for when you change your mind about posting it on this network.
 * It asks once more before anything goes. A live post is deleted from the network too when the
 * studio can do that itself; otherwise you delete it there first.
 */
export function RemovePiece({
  pieceId,
  platform,
  state,
  canDeleteLive,
  language,
  t,
}: {
  pieceId: string;
  platform: Platform;
  state: PublishState;
  /** The studio can delete the live post from the network itself. */
  canDeleteLive: boolean;
  language: UiLanguage;
  t: Strings;
}) {
  const [asking, setAsking] = useState(false);
  const network = platformLabel(platform, language);
  const fill = (text: string) => text.replaceAll("{platform}", network);
  const live = state === "posted" || state === "unknown";
  if (state === "sending") return null;

  if (!asking) {
    return (
      <div className="flex justify-end">
        <button type="button" onClick={() => setAsking(true)} className="btn btn-quiet text-danger" data-remove-piece>
          {fill(live ? t.removeLive : t.removePiece)}
        </button>
      </div>
    );
  }

  const form = (byHand: boolean, label: string, primary: boolean) => (
    <ActionForm action={removePieceAction}>
      <input type="hidden" name="pieceId" value={pieceId} />
      {byHand && <input type="hidden" name="byHand" value="yes" />}
      <SubmitButton pendingLabel={t.removingPiece} className={primary ? "btn-primary" : "btn-quiet"}>
        {label}
      </SubmitButton>
    </ActionForm>
  );

  return (
    <div role="group" className="space-y-3 rounded-lg border-s-4 border-danger bg-canvas p-4 text-sm" data-remove-confirm>
      <p className="font-semibold">{fill(live ? t.removeLive : t.removePiece)}</p>
      <p>{fill(!live ? t.removePieceHint : canDeleteLive ? t.removeLiveHint : t.removeLiveManual)}</p>
      <div className="flex flex-wrap items-start gap-2">
        {/* A live post the studio can delete: delete it there and here. If that fails, you can still delete it there yourself. */}
        {(!live || canDeleteLive) && form(false, t.removeConfirm, true)}
        {live && form(true, t.removeByHand, !canDeleteLive)}
        <button type="button" onClick={() => setAsking(false)} className="btn btn-quiet">
          {t.removeKeep}
        </button>
      </div>
    </div>
  );
}

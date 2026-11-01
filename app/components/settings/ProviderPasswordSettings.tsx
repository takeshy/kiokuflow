import { useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import type { UserSettings } from "~/types/settings";
import { hasEncryptionPassword } from "~/services/api-key-password";
import { clearCachedApiKey } from "~/services/api-key-cache";
import { invalidateIndexCache } from "~/utils/index-cache";
import { useProviderPasswords } from "./ProviderPasswords";
import { inputClass } from "./shared";

export function ProviderPasswordSettings({ settings }: { settings: UserSettings }) {
  const ja = useI18n().language === "ja";
  const { password: commonPassword, setPassword: rememberPassword } = useProviderPasswords();
  const revalidator = useRevalidator();
  const stored = hasEncryptionPassword(settings);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submit = async (action: "setup" | "unlock" | "change" | "lock") => {
    const currentPassword = password || commonPassword;
    const nextPassword = action === "change" ? newPassword : currentPassword;
    if ((action === "setup" || action === "change") && (nextPassword.length < 8 || nextPassword !== confirmation)) {
      setNotice(ja ? "8文字以上のパスワードを確認欄にも同じように入力してください。" : "Use at least 8 characters and matching confirmation."); return;
    }
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/settings/api-key-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, password: currentPassword, newPassword, confirmPassword: confirmation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      rememberPassword(action === "lock" ? "" : nextPassword);
      clearCachedApiKey(); invalidateIndexCache(); revalidator.revalidate();
      setNotice(action === "lock" ? (ja ? "すべてのAPIキーをロックしました。" : "All API keys locked.") : action === "change" ? (ja ? "すべてのAPIキーとファイル暗号化のパスワードを変更しました。" : "Password changed for all API keys and file encryption.") : (ja ? "秘密鍵を解除し、すべてのAPIキーを利用できるようにしました。" : "Private key unlocked. All saved API keys are ready to use."));
      setPassword(""); setNewPassword(""); setConfirmation(""); setChanging(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700" aria-label="Common encryption password" onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); if (!busy) void submit(!stored ? "setup" : changing ? "change" : "unlock"); }
  }}>
    <h4 className="text-sm font-medium">{ja ? "共通の暗号化パスワード" : "Common encryption password"}</h4>
    <p className="text-xs text-gray-500">{ja ? "APIキーは公開鍵で暗号化するので、保存時のパスワード入力は不要です。共通パスワードは秘密鍵を解除し、APIキーやファイルを復号するときに使います。" : "API keys are encrypted with the public key, so saving needs no password. The common password unlocks the private key to decrypt API keys and files."}</p>
    {commonPassword && <p role="status" className="text-xs text-green-600">{ja ? "共通パスワードは確認済みです。" : "Common password verified."}</p>}
    <label className="block text-sm">{stored ? (ja ? "現在のパスワード" : "Current password") : (ja ? "暗号化パスワード" : "Encryption password")}<input id="commonEncryptionPassword" type="password" autoComplete={stored ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>
    {changing && <label className="block text-sm">{ja ? "新しいパスワード" : "New password"}<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className={inputClass} /></label>}
    {(!stored || changing) && <label className="block text-sm">{ja ? "パスワード確認" : "Confirm password"}<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className={inputClass} /></label>}
    <p className="text-xs text-gray-500">{ja ? "入力したパスワードは設定画面のメモリ内だけで保持し、画面を閉じると破棄します。" : "The entered password stays only in settings-screen memory and is discarded when you leave."}</p>
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={busy} onClick={() => void submit(!stored ? "setup" : changing ? "change" : "unlock")} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50">{!stored ? (ja ? "パスワードを設定" : "Set password") : changing ? (ja ? "パスワードを変更" : "Change password") : (ja ? "確認してすべて解除" : "Verify and unlock all")}</button>
      {stored && <button type="button" disabled={busy} onClick={() => { setChanging(previous => !previous); setNewPassword(""); setConfirmation(""); }} className="rounded border px-3 py-2">{changing ? (ja ? "キャンセル" : "Cancel") : (ja ? "パスワード変更" : "Change password")}</button>}
      {stored && <button type="button" disabled={busy} onClick={() => void submit("lock")} className="rounded border px-3 py-2">{ja ? "すべてのAPIキーをロック" : "Lock all API keys"}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}

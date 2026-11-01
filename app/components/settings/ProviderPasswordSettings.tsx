import { useState } from "react";
import { useRevalidator } from "react-router";
import { useI18n } from "~/i18n/context";
import { COMPATIBLE_PROVIDERS, type UserSettings } from "~/types/settings";
import { decryptPrivateKey } from "~/services/crypto-core";
import { clearCachedApiKey } from "~/services/api-key-cache";
import { invalidateIndexCache } from "~/utils/index-cache";
import { useProviderPasswords, type PasswordProvider } from "./ProviderPasswords";
import { inputClass } from "./shared";

export function ProviderPasswordSettings({ provider, settings }: { provider: PasswordProvider; settings: UserSettings }) {
  const ja = useI18n().language === "ja";
  const { passwords, setPassword: rememberPassword } = useProviderPasswords();
  const revalidator = useRevalidator();
  const name = provider === "gemini" ? "Gemini / " + (ja ? "ファイル暗号化" : "file encryption") : provider === "openai" ? "OpenAI" : provider === "jev" ? "Jev" : COMPATIBLE_PROVIDERS[provider].name;
  const stored = provider === "gemini" ? !!(settings.encryptedApiKey || settings.encryption.encryptedPrivateKey) : provider === "openai" ? !!settings.openai?.encryptedApiKey : provider === "jev" ? !!settings.jev?.encryptedApiKey : !!settings.compatibleProviders?.[provider]?.encryptedApiKey;
  const endpoint = provider === "gemini" ? "/api/auth/unlock" : provider === "openai" ? "/api/openai/settings" : provider === "jev" ? "/api/jev/settings" : `/api/ai-providers/${provider}/settings`;
  const ready = !!passwords[provider];
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const submit = async (action: "prepare" | "unlock" | "change" | "lock") => {
    const currentPassword = password || passwords[provider] || "";
    const nextPassword = action === "change" ? newPassword : currentPassword;
    if (action === "prepare" || action === "change") {
      if (nextPassword.length < 8) { setNotice(ja ? "パスワードは8文字以上で入力してください。" : "Use at least 8 characters."); return; }
      if (nextPassword !== confirmation) { setNotice(ja ? "パスワードが一致しません。" : "Passwords do not match."); return; }
    }
    setBusy(true); setNotice("");
    try {
      if (action === "prepare") {
        rememberPassword(provider, nextPassword);
        setNotice(ja ? "入力しました。AIプロバイダーでAPIキーを保存してください。" : "Ready. Save your API key in AI providers.");
      } else {
        if (provider === "gemini" && !settings.encryptedApiKey) {
          await decryptPrivateKey(settings.encryption.encryptedPrivateKey, settings.encryption.salt, currentPassword);
        } else {
          const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: action === "change" ? "save" : action, password: currentPassword, ...(action === "change" ? { newPassword } : {}) }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        }
        rememberPassword(provider, action === "lock" ? "" : nextPassword);
        if (provider === "gemini") clearCachedApiKey();
        invalidateIndexCache(); revalidator.revalidate();
        setNotice(action === "lock" ? (ja ? "ロックしました。" : "Locked.") : action === "change" ? (ja ? "パスワードを変更しました。" : "Password changed.") : (ja ? "確認してロック解除しました。" : "Verified and unlocked."));
      }
      setPassword(""); setNewPassword(""); setConfirmation(""); setChanging(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 space-y-3 rounded border border-gray-200 p-4 dark:border-gray-700" aria-label={`${name} password`} onKeyDown={event => {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); if (!busy) void submit(!stored ? "prepare" : changing ? "change" : "unlock"); }
  }}>
    <h4 className="text-sm font-medium">{name} · {ja ? "暗号化パスワード" : "Encryption password"}</h4>
    <p className="text-xs text-gray-500">{ready ? (ja ? "この設定画面でAPIキーを保存できます。" : "Ready to save API keys in this settings screen.") : (ja ? "APIキーを保存・変更する前に、ここでパスワードを入力してください。" : "Enter the password here before saving or changing API keys.")}</p>
    <label className="block text-sm">{stored ? (ja ? "現在のパスワード" : "Current password") : (ja ? "暗号化パスワード" : "Encryption password")}<input type="password" autoComplete={stored ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} className={inputClass} /></label>
    {changing && <label className="block text-sm">{ja ? "新しいパスワード" : "New password"}<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className={inputClass} /></label>}
    {(!stored || changing) && <label className="block text-sm">{ja ? "パスワード確認" : "Confirm password"}<input type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className={inputClass} /></label>}
    {!stored && <p className="text-xs text-gray-500">{ja ? "APIキーはこのパスワードで暗号化して保存します。入力内容は、この設定画面を閉じると破棄されます。" : "API keys will be saved encrypted with this password. The entered password is discarded when you leave this settings screen."}</p>}
    <div className="flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={busy} onClick={() => void submit(!stored ? "prepare" : changing ? "change" : "unlock")} className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50">{!stored ? (ja ? "パスワードを設定" : "Set password") : changing ? (ja ? "パスワードを変更" : "Change password") : (ja ? "確認してロック解除" : "Verify and unlock")}</button>
      {stored && provider !== "gemini" && <button type="button" disabled={busy} onClick={() => { setChanging(previous => !previous); setNewPassword(""); setConfirmation(""); }} className="rounded border px-3 py-2">{changing ? (ja ? "キャンセル" : "Cancel") : (ja ? "パスワード変更" : "Change password")}</button>}
      {stored && provider !== "gemini" && <button type="button" disabled={busy} onClick={() => void submit("lock")} className="rounded border px-3 py-2">{ja ? "キーをロック" : "Lock key"}</button>}
      {ready && <button type="button" disabled={busy} onClick={() => { rememberPassword(provider, ""); setPassword(""); setNewPassword(""); setConfirmation(""); }} className="text-gray-500 hover:underline">{ja ? "入力をクリア" : "Clear entered password"}</button>}
    </div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}

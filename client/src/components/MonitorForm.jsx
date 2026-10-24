import React, { useMemo, useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronDown, Plus, X, Mail, Hash, MessageSquare, Webhook, Check, Lock, KeyRound, BadgeCheck } from 'lucide-react';
import { Button, cn } from './Button';
import { Input, Textarea, Segmented, Field, Toggle } from './Input';
import { useAuth } from '../contexts/AuthContext';
import { isHostCovered, hostOf } from '../hooks/useDomains';

const AUTH_TYPES = [
  { value: 'none', label: 'No key' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'apikey', label: 'API key header' },
  { value: 'basic', label: 'Username & password' },
];

/** Turns the friendly "API key" choice into the HTTP header the API expects. */
const buildAuthHeader = (auth) => {
  if (auth.type === 'bearer' && auth.token.trim()) return { name: 'Authorization', value: `Bearer ${auth.token.trim()}` };
  if (auth.type === 'apikey' && auth.headerName.trim() && auth.key.trim()) return { name: auth.headerName.trim(), value: auth.key.trim() };
  if (auth.type === 'basic' && auth.username) {
    const raw = `${auth.username}:${auth.password}`;
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
    return { name: 'Authorization', value: `Basic ${b64}` };
  }
  return null;
};

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'keep-alive', 'proxy-authorization'];
const COMMON_CODES = [200, 201, 202, 204, 301, 302, 304, 401, 403, 404];

const urlField = z
  .string()
  .trim()
  .url('Enter a full URL, including https://')
  .refine((v) => /^https?:\/\//i.test(v), 'Only http and https are supported');

const makeSchema = (isEdit) => z
  .object({
    name: z.string().trim().min(1, 'Give it a name').max(100),
    url: isEdit ? z.union([z.literal(''), urlField]) : urlField,
    intervalSeconds: z.number().int(),
    method: z.enum(['GET', 'POST', 'PUT', 'HEAD']),
    headers: z
      .array(z.object({ key: z.string().trim(), value: z.string(), stored: z.boolean().optional() }))
      .max(20, 'At most 20 headers'),
    body: z.string().max(10000, 'Body is limited to 10,000 characters'),
    keyword: z.string().trim().max(200),
    timeoutMs: z.number().int().min(1000).max(30000),
    expectedStatusCodes: z.array(z.number().int().min(100).max(599)).min(1, 'Select at least one status code'),
    alertChannelIds: z.array(z.string()),
    showOnStatusPage: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set();
    v.headers.forEach((h, i) => {
      if (!h.key && !h.value) return;
      if (!h.key) ctx.addIssue({ code: 'custom', path: ['headers', i, 'key'], message: 'Name required' });
      else if (!HEADER_NAME.test(h.key)) ctx.addIssue({ code: 'custom', path: ['headers', i, 'key'], message: 'Invalid header name' });
      else if (FORBIDDEN_HEADERS.includes(h.key.toLowerCase())) ctx.addIssue({ code: 'custom', path: ['headers', i, 'key'], message: 'Cannot override' });
      else if (seen.has(h.key.toLowerCase())) ctx.addIssue({ code: 'custom', path: ['headers', i, 'key'], message: 'Duplicate' });
      else if (!h.stored && !h.value) ctx.addIssue({ code: 'custom', path: ['headers', i, 'value'], message: 'Value required' });
      else if (/[\r\n]/.test(h.value)) ctx.addIssue({ code: 'custom', path: ['headers', i, 'value'], message: 'No line breaks' });
      seen.add(h.key.toLowerCase());
    });
    if (v.body && ['POST', 'PUT'].includes(v.method)) {
      const ct = v.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || '';
      if (ct.includes('json')) {
        try {
          JSON.parse(v.body);
        } catch {
          ctx.addIssue({ code: 'custom', path: ['body'], message: 'Content-Type is JSON but the body is not valid JSON' });
        }
      }
    }
  });

const CHANNEL_ICONS = { email: Mail, slack: Hash, discord: MessageSquare, webhook: Webhook };

const toFormValues = (m) => ({
  name: m?.name || '',
  url: m?._id ? '' : 'https://',
  intervalSeconds: m?.intervalSeconds || 300,
  method: m?.method || 'GET',
  // Stored header values are write-only: rows show the name, an empty value means "keep".
  headers: (m?.headerNames || []).map((key) => ({ key, value: '', stored: true })),
  body: '',
  showOnStatusPage: m?.showOnStatusPage !== false,
  keyword: m?.keyword || '',
  timeoutMs: m?.timeoutMs || 10000,
  expectedStatusCodes: m?.expectedStatusCodes?.length ? m.expectedStatusCodes : [200, 201, 202, 203, 204],
  alertChannelIds: (m?.alertChannelIds || []).map(String),
});

function Section({ title, hint, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-medium text-fg">{title}</h4>
        {hint && <span className="text-right font-mono text-[11px] text-fg-3">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function MonitorForm({ initialData, channels = [], domains = [], onSubmit, onCancel, isLoading, onManageChannels, onManageDomains }) {
  const { workspace } = useAuth();
  const minInterval = workspace?.limits?.minInterval || 60;
  const isEdit = Boolean(initialData?._id);
  const defaults = useMemo(() => toFormValues(initialData), [initialData]);
  const hasAdvanced =
    isEdit &&
    (defaults.headers.length > 0 || initialData?.hasBody || defaults.keyword || defaults.timeoutMs !== 10000 || !defaults.showOnStatusPage ||
      defaults.method !== 'GET' || defaults.expectedStatusCodes.join() !== '200,201,202,203,204');
  const [showAdvanced, setShowAdvanced] = useState(hasAdvanced);
  const [customCode, setCustomCode] = useState('');
  // For a stored body: keep it, replace it, or remove it. The stored value is never shown.
  const [bodyMode, setBodyMode] = useState(initialData?.hasBody ? 'keep' : 'replace');
  const schema = useMemo(() => makeSchema(isEdit), [isEdit]);
  const [auth, setAuth] = useState({ type: 'none', token: '', headerName: 'X-API-Key', key: '', username: '', password: '' });
  const [authError, setAuthError] = useState('');

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults });

  const { fields, append, remove } = useFieldArray({ control, name: 'headers' });
  const method = watch('method');
  const codes = watch('expectedStatusCodes');
  const selectedChannels = watch('alertChannelIds');
  const timeoutMs = watch('timeoutMs');
  const urlValue = watch('url');

  // Ownership decides which features are available (the server enforces the same rule).
  const host = hostOf(urlValue) || (isEdit ? initialData.host || hostOf(initialData.url) : null);
  const owned = isHostCovered(host, domains);
  const lockedTitle = host ? `Verify you own ${host} under Domains first` : 'Enter a URL first';

  const toggleCode = (code) => {
    const next = codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code].sort((a, b) => a - b);
    setValue('expectedStatusCodes', next, { shouldDirty: true, shouldValidate: true });
  };

  const addCustomCode = () => {
    const n = Number(customCode);
    if (Number.isInteger(n) && n >= 100 && n <= 599 && !codes.includes(n)) toggleCode(n);
    setCustomCode('');
  };

  const toggleChannel = (id) => {
    const next = selectedChannels.includes(id) ? selectedChannels.filter((c) => c !== id) : [...selectedChannels, id];
    setValue('alertChannelIds', next, { shouldDirty: true });
  };

  const submit = (values) => {
    const { url, body, headers: rows, ...rest } = values;
    // Name-only rows tell the server to keep the stored value.
    let headers = rows.filter((h) => h.key).map((h) => (h.value ? { name: h.key, value: h.value } : { name: h.key }));
    if (auth.type !== 'none') {
      const authHeader = buildAuthHeader(auth);
      if (!authHeader) {
        setAuthError('Fill in the key details, or choose “No key”.');
        return undefined;
      }
      // The key replaces any header with the same name.
      headers = [...headers.filter((h) => h.name.toLowerCase() !== authHeader.name.toLowerCase()), authHeader];
    }
    setAuthError('');
    const payload = { ...rest, headers, showOnStatusPage: owned ? rest.showOnStatusPage : false };
    if (url) payload.url = url; // blank on edit = keep the stored (encrypted) URL
    const sendsBody = ['POST', 'PUT'].includes(values.method);
    if (!isEdit) payload.body = sendsBody ? body : '';
    else if (!sendsBody || bodyMode === 'remove') payload.body = '';
    else if (bodyMode === 'replace') payload.body = body;
    return onSubmit(payload);
  };

  const allCodes = [...new Set([...COMMON_CODES, ...codes])].sort((a, b) => a - b);

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-7" noValidate>
      <div>
        <Input
          label="URL to monitor"
          hint={isEdit ? 'leave blank to keep the current URL' : null}
          placeholder={isEdit ? initialData.url : 'https://api.example.com/health'}
          autoComplete="off"
          spellCheck={false}
          {...register('url')}
          error={errors.url?.message}
        />
        <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-fg-3">
          <Lock className="h-3 w-3" /> URLs, headers and bodies are encrypted and can’t be viewed again after saving — by anyone.
        </p>
        {host && (
          owned ? (
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-up"><BadgeCheck className="h-3.5 w-3.5" /> {host} is a verified domain of your company.</p>
          ) : (
            <div className="mt-2 rounded-[10px] border border-down/30 bg-down/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-fg-2" role="alert">
              <strong className="text-down">{host} isn’t a verified domain of your company.</strong> PulseWatch only monitors websites a company has proven it owns.{' '}
              {onManageDomains ? (
                <button type="button" onClick={onManageDomains} className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">Verify it under Domains</button>
              ) : 'Ask an admin to verify it under Domains'}{' '}
              — it takes about a minute.
            </div>
          )
        )}
      </div>
      <Input label="Name" placeholder="Production API" {...register('name')} error={errors.name?.message} />

      <Field label="Check every" hint={minInterval > 30 ? '30s requires Pro' : null}>
        <Controller
          control={control}
          name="intervalSeconds"
          render={({ field }) => (
            <Segmented
              ariaLabel="Check interval"
              value={field.value}
              onChange={field.onChange}
              options={[30, 60, 300, 900].map((v) => ({
                value: v,
                label: v < 60 ? `${v}s` : `${v / 60} min`,
                disabled: v < minInterval || (!owned && v < 300),
                title: !owned && v < 300 ? lockedTitle : v < minInterval ? 'Upgrade to Pro under Billing for 30-second checks' : undefined,
              }))}
            />
          )}
        />
      </Field>

      {/* API key / authentication */}
      <Section title="Does this API need a key?" hint={owned ? 'stored encrypted · never shown again' : 'verified domains only'}>
        {owned ? (
          <div className="space-y-3">
            <Segmented size="sm" ariaLabel="API key type" value={auth.type} onChange={(t) => { setAuth((a) => ({ ...a, type: t })); setAuthError(''); }}
              options={AUTH_TYPES.map((o) => ({ ...o, label: o.value === 'none' && isEdit ? 'No change' : o.label }))} />
            {auth.type === 'bearer' && (
              <Input label="Token" type="password" autoComplete="off" placeholder="sk_live_…" value={auth.token} onChange={(e) => setAuth((a) => ({ ...a, token: e.target.value }))}
                hint="sent as Authorization: Bearer …" />
            )}
            {auth.type === 'apikey' && (
              <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
                <Input label="Header name" value={auth.headerName} onChange={(e) => setAuth((a) => ({ ...a, headerName: e.target.value }))} spellCheck={false} className="font-mono text-[13px]" />
                <Input label="Key" type="password" autoComplete="off" placeholder="your API key" value={auth.key} onChange={(e) => setAuth((a) => ({ ...a, key: e.target.value }))} />
              </div>
            )}
            {auth.type === 'basic' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Username" autoComplete="off" value={auth.username} onChange={(e) => setAuth((a) => ({ ...a, username: e.target.value }))} />
                <Input label="Password" type="password" autoComplete="new-password" value={auth.password} onChange={(e) => setAuth((a) => ({ ...a, password: e.target.value }))} />
              </div>
            )}
            {isEdit && auth.type === 'none' && initialData.headerNames?.length > 0 && (
              <p className="text-[12px] text-fg-3">Stored (hidden): {initialData.headerNames.join(', ')}. Choose a type above to replace a key.</p>
            )}
            {authError && <p className="text-xs text-down">{authError}</p>}
          </div>
        ) : (
          <p className="flex items-center gap-2 rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-[13px] text-fg-3">
            <KeyRound className="h-4 w-4 shrink-0" /> Sending API keys is available for domains you’ve verified. This keeps keys from being sent to sites you don’t own.
          </p>
        )}
      </Section>

      {/* Alert routing */}
      <Section title="Alert channels" hint={selectedChannels.length ? `${selectedChannels.length} selected` : 'none — alerts off'}>
        {channels.length === 0 ? (
          <div className="rounded-[10px] border border-dashed border-line-strong px-4 py-4 text-[13px] text-fg-3">
            No channels yet.{' '}
            {!onManageChannels && 'Ask a workspace admin to add one.'}
            {onManageChannels && (
              <button type="button" onClick={onManageChannels} className="text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                Add Slack, Discord, email or a webhook
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => {
              const on = selectedChannels.includes(c._id);
              const Icon = CHANNEL_ICONS[c.type] || Webhook;
              return (
                <button
                  key={c._id}
                  type="button"
                  onClick={() => toggleChannel(c._id)}
                  aria-pressed={on}
                  className={cn(
                    'flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors',
                    on ? 'border-fg bg-raised-2' : 'border-line-strong hover:border-fg-3'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0 text-fg-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{c.label}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-fg-3">
                      {c.type}{!c.isActive && ' · paused'}
                    </span>
                  </span>
                  <span className={cn('flex h-4 w-4 items-center justify-center rounded border', on ? 'border-fg bg-fg text-bg' : 'border-line-strong')}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {/* Advanced */}
      <div className="rounded-xl border border-line">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3.5 text-[13px] font-medium text-fg-2 transition-colors hover:text-fg"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
        >
          <span>
            Advanced settings
            <span className="ml-2 font-mono text-[11px] font-normal text-fg-3">method · headers · body · assertions · timeout</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', showAdvanced && 'rotate-180')} />
        </button>

        <div className={cn('grid transition-[grid-template-rows] duration-500 ease-out-expo', showAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            <div className="space-y-7 border-t border-line px-4 py-5">
              <Section title="HTTP method">
                <Controller
                  control={control}
                  name="method"
                  render={({ field }) => (
                    <Segmented ariaLabel="HTTP method" value={field.value} onChange={field.onChange}
                      options={['GET', 'POST', 'PUT', 'HEAD'].map((m) => ({ value: m, label: m, disabled: !owned && ['POST', 'PUT'].includes(m), title: !owned && ['POST', 'PUT'].includes(m) ? lockedTitle : undefined }))} />
                  )}
                />
              </Section>

              <Section title="Request headers" hint={`${fields.length}/20`}>
                <div className="space-y-2">
                  {fields.map((f, i) => (
                    <div key={f.id} className="flex items-start gap-2">
                      <div className="flex-1">
                        <input
                          className="field font-mono text-[13px] read-only:opacity-70"
                          placeholder="Authorization"
                          readOnly={Boolean(f.stored)}
                          aria-label={`Header ${i + 1} name`}
                          aria-invalid={errors.headers?.[i]?.key ? 'true' : undefined}
                          spellCheck={false}
                          {...register(`headers.${i}.key`)}
                        />
                        {errors.headers?.[i]?.key && <p className="mt-1 text-[11px] text-down">{errors.headers[i].key.message}</p>}
                      </div>
                      <div className="flex-[1.4]">
                        <input
                          className="field font-mono text-[13px]"
                          type="password"
                          placeholder={f.stored ? '•••••• stored — blank keeps it' : 'Bearer sk_live_…'}
                          aria-label={`Header ${i + 1} value`}
                          aria-invalid={errors.headers?.[i]?.value ? 'true' : undefined}
                          autoComplete="off"
                          spellCheck={false}
                          {...register(`headers.${i}.value`)}
                        />
                        {errors.headers?.[i]?.value && <p className="mt-1 text-[11px] text-down">{errors.headers[i].value.message}</p>}
                      </div>
                      <button type="button" onClick={() => remove(i)} className="mt-2 rounded-md p-1.5 text-fg-3 hover:bg-raised-2 hover:text-down" aria-label={`Remove header ${i + 1}`}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  {!owned && <p className="text-[12px] text-fg-3">Custom headers are available for verified domains.</p>}
                  {owned && fields.length < 20 && (
                    <button type="button" onClick={() => append({ key: '', value: '', stored: false })} className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[13px] text-fg-2 hover:text-fg">
                      <Plus className="h-3.5 w-3.5" /> Add header
                    </button>
                  )}
                  {errors.headers?.message && <p className="text-xs text-down">{errors.headers.message}</p>}
                </div>
              </Section>

              {['POST', 'PUT'].includes(method) && isEdit && initialData?.hasBody && (
                <Section title="Request body" hint="stored encrypted">
                  <Segmented
                    size="sm"
                    ariaLabel="Request body"
                    value={bodyMode}
                    onChange={setBodyMode}
                    options={[{ value: 'keep', label: 'Keep stored body' }, { value: 'replace', label: 'Replace' }, { value: 'remove', label: 'Remove' }]}
                  />
                </Section>
              )}

              {['POST', 'PUT'].includes(method) && (!isEdit || !initialData?.hasBody || bodyMode === 'replace') && (
                <Textarea
                  label="Request body"
                  hint="JSON is sent as application/json"
                  placeholder={'{\n  "ping": true\n}'}
                  spellCheck={false}
                  {...register('body')}
                  error={errors.body?.message}
                />
              )}

              <Section title="Accepted status codes" hint="anything else = down">
                <div className="flex flex-wrap gap-1.5">
                  {allCodes.map((code) => {
                    const on = codes.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleCode(code)}
                        aria-pressed={on}
                        className={cn(
                          'h-7 rounded-md border px-2.5 font-mono text-xs transition-colors',
                          on ? 'border-fg bg-fg text-bg' : 'border-line-strong text-fg-2 hover:border-fg-3 hover:text-fg'
                        )}
                      >
                        {code}
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-1">
                    <input
                      value={customCode}
                      onChange={(e) => setCustomCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addCustomCode();
                        }
                      }}
                      placeholder="other"
                      inputMode="numeric"
                      aria-label="Add a custom status code"
                      className="h-7 w-16 rounded-md border border-line-strong bg-bg px-2 font-mono text-xs text-fg placeholder:text-fg-3 focus:border-fg focus:outline-none"
                    />
                    <button type="button" onClick={addCustomCode} className="h-7 rounded-md px-1.5 text-fg-3 hover:text-fg" aria-label="Add status code">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {errors.expectedStatusCodes && <p className="text-xs text-down">{errors.expectedStatusCodes.message}</p>}
              </Section>

              <Input
                label="Response must contain"
                hint={method === 'HEAD' ? 'ignored for HEAD' : 'case-sensitive'}
                placeholder='e.g. "status":"ok"'
                spellCheck={false}
                disabled={method === 'HEAD'}
                {...register('keyword')}
                error={errors.keyword?.message}
              />

              <Section title="Public status page">
                <Controller
                  control={control}
                  name="showOnStatusPage"
                  render={({ field }) => (
                    <label className="flex items-center justify-between gap-4 text-[13px] text-fg-2">
                      <span>Show this monitor (by name only) when the workspace status page is on</span>
                      <Toggle checked={owned && field.value} onChange={field.onChange} label="Show on status page" disabled={!owned} />
                    </label>
                  )}
                />
              </Section>

              <Section title="Timeout" hint={`${(timeoutMs / 1000).toFixed(0)}s`}>
                <Controller
                  control={control}
                  name="timeoutMs"
                  render={({ field }) => (
                    <div>
                      <input
                        type="range"
                        min={1}
                        max={30}
                        step={1}
                        value={field.value / 1000}
                        onChange={(e) => field.onChange(Number(e.target.value) * 1000)}
                        className="w-full"
                        aria-label="Request timeout in seconds"
                      />
                      <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-3">
                        <span>1s</span><span>10s</span><span>20s</span><span>30s</span>
                      </div>
                    </div>
                  )}
                />
              </Section>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-line pt-5">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" isLoading={isLoading} disabled={(Boolean(host) && !owned) || (isEdit && !isDirty && auth.type === 'none' && bodyMode === (initialData?.hasBody ? 'keep' : 'replace'))}>
          {isEdit ? 'Save changes' : 'Start monitoring'}
        </Button>
      </div>
    </form>
  );
}

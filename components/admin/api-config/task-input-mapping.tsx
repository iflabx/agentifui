'use client';

import { useTranslations } from 'next-intl';

import type { InstanceFormData } from './instance-form-types';

export function TaskInputMapping({
  config,
  disabled,
  onChange,
}: {
  config: InstanceFormData['config'];
  disabled: boolean;
  onChange: (value: InstanceFormData['config']['task_input']) => void;
}) {
  const t = useTranslations('pages.admin.apiConfig.page.taskInput');
  const fields = (config.dify_parameters?.user_input_form || []).flatMap(
    item => {
      const entries = Object.entries(item);
      if (entries.length !== 1) return [];
      const [type, field] = entries[0];
      return ['text-input', 'paragraph'].includes(type) &&
        field &&
        typeof field.variable === 'string' &&
        field.variable
        ? [field]
        : [];
    }
  );
  const variable = config.task_input?.text_variable;
  const matches = fields.filter(field => field.variable === variable);
  const resolved =
    variable === undefined
      ? fields.length === 1
        ? fields[0]
        : undefined
      : matches.length === 1
        ? matches[0]
        : undefined;
  const invalid = typeof variable === 'string' && !resolved;
  const explanation = invalid
    ? t('invalid', { variable })
    : variable === null
      ? t('parametersOnlyNote')
      : resolved
        ? t(variable === undefined ? 'autoResolved' : 'explicitResolved', {
            variable: resolved.variable,
          })
        : fields.length > 1
          ? t('ambiguous')
          : t('noText');

  return (
    <div>
      <label
        htmlFor="task-text-variable"
        className="mb-2 block font-serif text-sm font-medium text-stone-700 dark:text-stone-300"
      >
        {t('label')}
      </label>
      <select
        id="task-text-variable"
        value={variable === undefined ? 'auto' : JSON.stringify(variable)}
        disabled={disabled}
        aria-describedby="task-text-variable-note"
        onChange={event =>
          onChange(
            event.target.value === 'auto'
              ? undefined
              : { text_variable: JSON.parse(event.target.value) }
          )
        }
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-serif text-stone-900 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-100"
      >
        <option value="auto">{t('auto')}</option>
        <option value="null">{t('parametersOnly')}</option>
        {invalid && (
          <option value={JSON.stringify(variable)}>
            {t('invalidOption', { variable })}
          </option>
        )}
        {[...new Map(fields.map(field => [field.variable, field])).values()]
          .filter(field => !(invalid && field.variable === variable))
          .map(field => (
            <option key={field.variable} value={JSON.stringify(field.variable)}>
              {field.label || field.variable} ({field.variable})
            </option>
          ))}
      </select>
      <p
        id="task-text-variable-note"
        className="mt-2 font-serif text-xs text-stone-500 dark:text-stone-400"
      >
        {explanation} {t('schemaNote')}
      </p>
    </div>
  );
}

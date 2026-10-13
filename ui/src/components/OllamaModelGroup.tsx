import type { ReactNode } from 'react';
import styles from './OllamaModelGroup.module.css';

interface OllamaModelGroupProps {
  /** Provider label + install status (and any install link), laid out in a row. */
  header: ReactNode;
  /** Radio group name shared with the sibling CLI radios. */
  radioName: string;
  /** Pulled, generation-capable model names. */
  models: string[];
  /** Model whose radio is checked, or null when a non-Ollama option is picked. */
  selected: string | null;
  onSelect: (model: string) => void;
  /** Notices rendered between the header and the model list. */
  children?: ReactNode;
}

/**
 * The Ollama entry of a provider radio list: a boxed group with one radio per
 * pulled model. Shared by onboarding and Settings → LLM so both pickers stay
 * identical.
 */
export function OllamaModelGroup({
  header,
  radioName,
  models,
  selected,
  onSelect,
  children,
}: OllamaModelGroupProps) {
  return (
    <li className={styles.group}>
      <div className={styles.header}>{header}</div>
      {children}
      {models.length > 0 && (
        <ul className={styles.modelList}>
          {models.map((name) => (
            <li key={name}>
              <label>
                <input
                  type="radio"
                  name={radioName}
                  value={`ollama:${name}`}
                  checked={selected === name}
                  onChange={() => onSelect(name)}
                />
                <strong className={styles.modelName}>{name}</strong>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

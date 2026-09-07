import type { ReactNode } from 'react';
import { label } from '../format';

export function Card({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <section className="carte">
      {title === null ? null : <h2>{title}</h2>}
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string | null;
  actions: ReactNode;
}) {
  return (
    <header className="entete">
      <div>
        <h1>{title}</h1>
        {subtitle === null ? null : <p>{subtitle}</p>}
      </div>
      <div className="ligne-boutons" style={{ marginTop: 0 }}>
        {actions}
      </div>
    </header>
  );
}

export function Message({ kind, text }: { kind: 'erreur' | 'succes' | 'info'; text: string | null }) {
  if (text === null) {
    return null;
  }
  return <div className={`message ${kind}`}>{text}</div>;
}

export function Field({
  label: fieldLabel,
  hint,
  children,
}: {
  label: string;
  hint: string | null;
  children: ReactNode;
}) {
  return (
    <div className="champ">
      <label>{fieldLabel}</label>
      {children}
      {hint === null ? null : <span className="aide">{hint}</span>}
    </div>
  );
}

const BADGE_TONES: Readonly<Record<string, string>> = {
  ACTIF: 'succes',
  CONFORME: 'succes',
  LIBERE: 'succes',
  ACCEPTE: 'succes',
  INTERNE: 'info',
  EN_COURS: 'info',
  EXTERNE: 'avertissement',
  A_SURVEILLER: 'avertissement',
  ACCEPTE_SOUS_RESERVE: 'avertissement',
  RECONTROLE_REQUIS: 'avertissement',
  BLOQUE: 'alerte',
  NON_CONFORME: 'alerte',
  REJETE: 'alerte',
  PERTE: 'alerte',
};

export function Badge({ value }: { value: string | null }) {
  if (value === null) {
    return <span>-</span>;
  }
  return <span className={`badge ${BADGE_TONES[value] ?? ''}`}>{label(value)}</span>;
}

export function EmptyState({ text }: { text: string }) {
  return <div className="vide">{text}</div>;
}

export function DataTable({
  columns,
  children,
  isEmpty,
  emptyText,
}: {
  columns: readonly Readonly<{ key: string; label: string; numeric: boolean }>[];
  children: ReactNode;
  isEmpty: boolean;
  emptyText: string;
}) {
  if (isEmpty) {
    return <EmptyState text={emptyText} />;
  }
  return (
    <div className="tableau-conteneur">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.numeric ? 'nombre' : ''}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function KeyValue({ items }: { items: readonly Readonly<{ key: string; value: ReactNode }>[] }) {
  return (
    <div className="paires">
      {items.map((item) => (
        <div className="paire" key={item.key}>
          <div className="cle">{item.key}</div>
          <div className="valeur">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

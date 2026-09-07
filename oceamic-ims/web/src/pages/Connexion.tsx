import { useState } from 'react';
import { useAuth } from '../auth';
import { Card, Field, Message } from '../components/ui';

export function Connexion() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username, password);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-connexion">
      <Card title={null}>
        <h1 style={{ fontSize: 22, marginTop: 0 }}>
          OCEAMIC <span style={{ color: 'var(--accent)' }}>IMS</span>
        </h1>
        <p style={{ color: 'var(--texte-doux)', marginTop: 0 }}>
          Gestion matière première, stock et qualité
        </p>
        <Message kind="erreur" text={error} />
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Field label="Identifiant" hint={null}>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label="Mot de passe" hint={null}>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
          </div>
          <div className="ligne-boutons">
            <button type="submit" disabled={busy}>
              {busy ? 'Connexion...' : 'Se connecter'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

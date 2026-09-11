import { useState } from 'react';
import oceamicMark from '../assets/oceamic-mark.png';
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
        <div className="connexion-marque">
          <img src={oceamicMark} alt="OCEAMIC" />
          <h1>
            OCEAMIC
            <span>Laayoune II</span>
          </h1>
          <p>Système de gestion industrielle — IMS</p>
        </div>
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

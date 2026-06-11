// app/index.tsx
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { AuthError } from '../api/restClient';
import { connect, restore } from '../connection';

export default function ConnectScreen() {
  const [url, setUrl] = useState('http://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restore()
      .then((ok) => { if (ok) router.replace('/sessions'); })
      .catch(() => setError('Saved connection failed — gateway unreachable? Check your VPN.'))
      .finally(() => setBusy(false));
  }, []);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      await connect(url.trim(), username.trim(), password);
      router.replace('/sessions');
    } catch (e) {
      if (e instanceof AuthError) setError('Invalid username or password.');
      else setError('Could not reach the gateway. Is Tailscale connected?');
    } finally {
      setBusy(false);
    }
  }

  if (busy && !error) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Gateway URL (tailnet)</Text>
      <TextInput style={styles.input} value={url} onChangeText={setUrl}
        autoCapitalize="none" autoCorrect={false} placeholder="http://100.x.y.z:9119" />
      <Text style={styles.label}>Username</Text>
      <TextInput style={styles.input} value={username} onChangeText={setUsername}
        autoCapitalize="none" autoCorrect={false} />
      <Text style={styles.label}>Password</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button title={busy ? 'Connecting…' : 'Connect'} onPress={onConnect} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 8, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10 },
  error: { color: '#c00' },
});

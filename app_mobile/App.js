import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  KeyboardAvoidingView, 
  Platform,
  Image
} from 'react-native';
import AppNavigator from './src/navigation/AppNavigator';
import { auth } from './firebaseConfig';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { makeRedirectUri } from 'expo-auth-session';
import firebase from 'firebase/compat/app';

WebBrowser.maybeCompleteAuthSession();

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Google Auth Hook
  const [request, response, promptAsync] = Google.useAuthRequest({
    webClientId: "522194848214-hrquv9j5vojrdtildclohg1k3hbqa6hp.apps.googleusercontent.com",
    iosClientId: "522194848214-dpkb6cr31v9c7db2ln9a8v0sjk7um6dd.apps.googleusercontent.com",
    redirectUri: makeRedirectUri({
      preferNative: false,
    }),
  });

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((usr) => {
      setUser(usr);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      const credential = firebase.auth.GoogleAuthProvider.credential(id_token);
      auth.signInWithCredential(credential).catch((e) => alert(e.message));
    }
  }, [response]);

  const handleLogin = async () => {
    if (!email || !password) return alert('Introduce tus datos');
    try {
      setLoading(true);
      await auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !user) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#64ffda" />
      </View>
    );
  }

  if (!user) {
    return (
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.card}>
          <Text style={styles.title}>TrackWealth</Text>
          <Text style={styles.subtitle}>Tu patrimonio bajo control</Text>
          
          <TextInput 
            style={styles.input} 
            placeholder="Email" 
            placeholderTextColor="#8892b0"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
          />
          <TextInput 
            style={styles.input} 
            placeholder="Contraseña" 
            placeholderTextColor="#8892b0"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          
          <TouchableOpacity style={styles.button} onPress={handleLogin}>
            <Text style={styles.buttonText}>Iniciar Sesión</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>o con</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity 
            style={styles.googleButton} 
            onPress={() => promptAsync()}
            disabled={!request}
          >
            <View style={styles.googleIconContainer}>
               <Image 
                 source={{ uri: 'https://upload.wikimedia.org/wikipedia/commons/5/53/Google_%22G%22_Logo.svg' }}
                 style={{ width: 20, height: 20 }}
               />
            </View>
            <Text style={styles.googleButtonText}>Continuar con Google</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return <AppNavigator />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#040b16', // OLED Black
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    padding: 30,
    backgroundColor: '#0a192f',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#233554',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ccd6f6',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#8892b0',
    textAlign: 'center',
    marginBottom: 40,
  },
  input: {
    width: '100%',
    backgroundColor: '#112240',
    color: '#ccd6f6',
    padding: 18,
    borderRadius: 12,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#233554',
    fontSize: 16,
  },
  button: {
    width: '100%',
    backgroundColor: '#64ffda',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#0a192f',
    fontWeight: 'bold',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 30,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#233554',
  },
  dividerText: {
    color: '#8892b0',
    paddingHorizontal: 15,
    fontSize: 14,
  },
  googleButton: {
    width: '100%',
    backgroundColor: '#ccd6f6',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconContainer: {
    marginRight: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 2
  },
  googleButtonText: {
    color: '#0a192f',
    fontWeight: '700',
    fontSize: 15,
  }
});

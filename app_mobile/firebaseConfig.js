import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCD0-0hj4PagQthwBlo_5RcMXhYHjag0xs",
  authDomain: "wealthtracker-d2a0d.firebaseapp.com",
  projectId: "wealthtracker-d2a0d",
  storageBucket: "wealthtracker-d2a0d.firebasestorage.app",
  messagingSenderId: "522194848214",
  appId: "1:522194848214:web:e6592a18c7b3b06365fc77",
  measurementId: "G-41GWKKRN5D"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

export const auth = firebase.auth();
export default firebase;

import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";

const firebaseConfig = {
  apiKey: "AIzaSyAPikdmfPWILjPcfpOb7ZNjqkrgcTobG4s",
  authDomain: "aplicacao-de-emulsao.firebaseapp.com",
  projectId: "aplicacao-de-emulsao",
  storageBucket: "aplicacao-de-emulsao.firebasestorage.app",
  messagingSenderId: "594699607402",
  appId: "1:594699607402:web:d8b4b5015bc02e90dbd913",
  measurementId: "G-S85JJRWHK1"
};

const app = initializeApp(firebaseConfig);

isSupported().then((supported) => {
  if (supported) {
    getAnalytics(app);
  }
});

export default app;

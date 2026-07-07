import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Index() {
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('onboardingComplete').then((v) => {
      setDone(v === 'true');
      setReady(true);
    });
  }, []);

  if (!ready) return null;
  return <Redirect href={done ? '/home' : '/onboarding'} />;
}

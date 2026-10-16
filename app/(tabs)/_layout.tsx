import { Tabs, useRouter } from 'expo-router';
import { View } from 'react-native';
import MemoryFab from '../../src/components/MemoryFab';
import { BottomBar } from '../../src/components/AppNav';

export default function TabsLayout() {
  const router = useRouter();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false }}
        // The same bar the screens over the tabs draw (src/components/AppNav.tsx),
        // so the icons sit in the same place everywhere.
        tabBar={({ navigation }) => (
          <BottomBar
            onSelect={(href) => {
              // Ask opens the full chat screen over the tabs, as from Home's pill.
              if (href === '/chat') router.push('/chat');
              else navigation.navigate(href.slice(1));
            }}
          />
        )}
      >
        <Tabs.Screen name="home" options={{ title: 'Home' }} />
        <Tabs.Screen name="timeline" options={{ title: 'Timeline' }} />
        <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
        <Tabs.Screen name="ask" options={{ title: 'Ask' }} />
        {/* Profile is opened from Home's top-right corner, not the bar. */}
        <Tabs.Screen name="profile" options={{ href: null }} />
      </Tabs>

      {/* Center memory button: taps open the fan-out actions */}
      <MemoryFab />
    </View>
  );
}

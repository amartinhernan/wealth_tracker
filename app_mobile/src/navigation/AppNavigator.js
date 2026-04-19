import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import DashboardScreen from '../screens/DashboardScreen';
import PortfolioScreen from '../screens/PortfolioScreen';
import TransactionsScreen from '../screens/TransactionsScreen';

const Tab = createBottomTabNavigator();

const DarkTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#040b16',
    card: '#0a192f',
    text: '#ccd6f6',
    border: '#233554',
    primary: '#64ffda',
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer theme={DarkTheme}>
      <StatusBar style="light" />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: '#0a192f', borderBottomWidth: 1, borderBottomColor: '#233554' },
          headerTintColor: '#e6f1ff',
          tabBarStyle: { backgroundColor: '#0a192f', borderTopWidth: 1, borderTopColor: '#233554' },
          tabBarActiveTintColor: '#64ffda',
          tabBarInactiveTintColor: '#8892b0',
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            if (route.name === 'Dashboard') iconName = focused ? 'pie-chart' : 'pie-chart-outline';
            else if (route.name === 'Portfolio') iconName = focused ? 'wallet' : 'wallet-outline';
            else if (route.name === 'Transacciones') iconName = focused ? 'list' : 'list-outline';
            return <Ionicons name={iconName} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="Portfolio" component={PortfolioScreen} />
        <Tab.Screen name="Transacciones" component={TransactionsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

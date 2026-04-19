import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  RefreshControl, 
  ActivityIndicator,
  SafeAreaView 
} from 'react-native';
import { tokenFetch } from '../services/api';
import { Ionicons } from '@expo/vector-icons';

export default function TransactionsScreen() {
  const [transactions, setTransactions] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const res = await tokenFetch('/transactions');
      setTransactions(res);
    } catch (e) {
      console.error(e);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  const renderItem = ({ item }) => {
    const isPositive = item.amount > 0;
    const isTransfer = item.category === 'Traspaso';
    
    let icon = isTransfer ? 'swap-horizontal' : (isPositive ? 'arrow-down' : 'arrow-up');
    let iconColor = isTransfer ? '#8892b0' : (isPositive ? '#64ffda' : '#ff6b6b');

    return (
      <View style={styles.txCard}>
        <View style={[styles.iconBox, {backgroundColor: isTransfer ? '#112240' : (isPositive ? 'rgba(100,255,218,0.1)' : 'rgba(255,107,107,0.1)')}]}>
          <Ionicons name={icon} size={22} color={iconColor} />
        </View>
        <View style={styles.txMain}>
          <Text style={styles.txTitle} numberOfLines={1}>{item.description}</Text>
          <Text style={styles.txDate}>{item.date} • {item.account}</Text>
        </View>
        <View style={styles.amountBox}>
          <Text style={[styles.txAmount, { color: iconColor }]}>
            {isPositive && !isTransfer ? '+' : ''}{formatter.format(item.amount)}
          </Text>
          <Text style={styles.txCategory}>{item.category || 'Sin categoría'}</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
            <Text style={styles.mainTitle}>Movimientos</Text>
        </View>
        <FlatList
          data={transactions}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#64ffda" />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
                <Ionicons name="receipt-outline" size={60} color="#233554" />
                <Text style={styles.emptyText}>No hay transacciones aún</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#040b16',
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 20,
  },
  mainTitle: {
    color: '#ccd6f6',
    fontSize: 32,
    fontWeight: '800',
  },
  txCard: {
    flexDirection: 'row',
    backgroundColor: '#0a192f',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#233554',
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  txMain: {
    flex: 1,
  },
  txTitle: {
    color: '#ccd6f6',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  txDate: {
    color: '#8892b0',
    fontSize: 12,
  },
  amountBox: {
    alignItems: 'flex-end',
  },
  txAmount: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 4,
  },
  txCategory: {
    color: '#text-3', // Placeholder color if constant doesn't exist
    color: '#6B6880',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  empty: {
    marginTop: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#8892b0',
    fontSize: 16,
    marginTop: 15,
  }
});

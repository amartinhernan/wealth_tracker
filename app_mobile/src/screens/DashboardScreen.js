import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  RefreshControl, 
  Dimensions, 
  TouchableOpacity,
  SafeAreaView
} from 'react-native';
import { tokenFetch } from '../services/api';
import { LineChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width } = Dimensions.get('window');

export default function DashboardScreen() {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = async () => {
    try {
      const res = await tokenFetch('/data');
      setData(res);
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

  if (!data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#64ffda" />
      </View>
    );
  }

  const chartData = data.history.map(item => ({
    value: item.total,
    label: new Date(item.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
  }));

  const formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView 
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#64ffda" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>Hola de nuevo,</Text>
          <Text style={styles.mainTitle}>Tu Patrimonio</Text>
        </View>

        <LinearGradient
          colors={['#112240', '#0a192f']}
          style={styles.mainCard}
        >
          <Text style={styles.mainLabel}>Balance Total</Text>
          <Text style={styles.mainValue}>{formatter.format(data.kpis.total)}</Text>
          
          <View style={styles.trendContainer}>
             <Ionicons name={data.kpis.profit >= 0 ? "trending-up" : "trending-down"} size={16} color={data.kpis.profit >= 0 ? "#64ffda" : "#ff6b6b"} />
             <Text style={[styles.trendText, {color: data.kpis.profit >= 0 ? "#64ffda" : "#ff6b6b"}]}>
               {formatter.format(data.kpis.profit)} ({(data.kpis.profit / (data.kpis.total - data.kpis.profit) * 100).toFixed(2)}%)
             </Text>
          </View>
        </LinearGradient>

        <View style={styles.row}>
           <View style={styles.secondaryCard}>
              <Text style={styles.cardLabel}>TWR</Text>
              <Text style={styles.cardValue}>{(data.kpis.twr * 100).toFixed(2)}%</Text>
           </View>
           <View style={styles.secondaryCard}>
              <Text style={styles.cardLabel}>MWR</Text>
              <Text style={styles.cardValue}>{(data.kpis.mwr * 100).toFixed(2)}%</Text>
           </View>
        </View>

        <View style={styles.chartHeader}>
          <Text style={styles.sectionTitle}>Evolución Histórica</Text>
          <TouchableOpacity onPress={loadData}>
            <Ionicons name="filter-outline" size={20} color="#8892b0" />
          </TouchableOpacity>
        </View>

        <View style={styles.chartContainer}>
          {chartData.length > 1 ? (
            <LineChart
              data={chartData}
              width={width - 50}
              height={200}
              spacing={(width - 90) / Math.max(1, chartData.length - 1)}
              thickness={3}
              color="#64ffda"
              hideDataPoints
              curved
              animateOnDataChange
              animationDuration={1200}
              areaChart
              startFillColor="#64ffda"
              endFillColor="transparent"
              startOpacity={0.2}
              endOpacity={0}
              yAxisColor="transparent"
              xAxisColor="transparent"
              hideRules
              hideYAxisText
              initialSpacing={0}
            />
          ) : (
            <View style={{height: 200, justifyContent: 'center'}}>
               <Text style={{color: '#8892b0'}}>Sin datos suficientes</Text>
            </View>
          )}
        </View>

        <View style={{height: 100}} />
      </ScrollView>
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
    paddingHorizontal: 20,
  },
  center: {
    flex: 1,
    backgroundColor: '#040b16',
    justifyContent: 'center',
    alignItems: 'center'
  },
  header: {
    marginTop: 20,
    marginBottom: 25,
  },
  greeting: {
    color: '#8892b0',
    fontSize: 16,
    marginBottom: 4,
  },
  mainTitle: {
    color: '#ccd6f6',
    fontSize: 32,
    fontWeight: '800',
  },
  mainCard: {
    borderRadius: 24,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#233554',
  },
  mainLabel: {
    color: '#8892b0',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  mainValue: {
    color: '#ccd6f6',
    fontSize: 36,
    fontWeight: '800',
    marginBottom: 12,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendText: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 6,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 30,
    gap: 15,
  },
  secondaryCard: {
    flex: 1,
    backgroundColor: '#0a192f',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#233554',
  },
  cardLabel: {
    color: '#8892b0',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  cardValue: {
    color: '#ccd6f6',
    fontSize: 22,
    fontWeight: '800',
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#ccd6f6',
    fontSize: 20,
    fontWeight: '700',
  },
  chartContainer: {
    backgroundColor: '#0a192f',
    borderRadius: 24,
    padding: 15,
    paddingTop: 25,
    borderWidth: 1,
    borderColor: '#233554',
    alignItems: 'center',
    overflow: 'hidden',
  }
});

import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  RefreshControl, 
  ActivityIndicator,
  SafeAreaView
} from 'react-native';
import { tokenFetch } from '../services/api';
import { PieChart } from 'react-native-gifted-charts';
import { LinearGradient } from 'expo-linear-gradient';

export default function PortfolioScreen() {
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

  const formatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

  const colors = { 
    'CASH': '#64ffda', 
    'CRYPTO': '#ffb86c', 
    'FUNDS': '#bd93f9', 
    'ETFS': '#ff79c6', 
    'OTROS': '#8be9fd' 
  };
  const getPortColors = (port) => colors[port?.toUpperCase()] || '#f1fa8c';

  let totalValue = 0;
  const chartData = Object.keys(data.portfolio_grouped).map(port => {
    let pt = 0;
    data.portfolio_grouped[port].forEach(item => { pt += item.value; });
    totalValue += pt;
    return {
      value: pt,
      color: getPortColors(port),
      text: port,
    };
  }).filter(item => item.value > 0);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView 
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#64ffda" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.mainTitle}>Vistazo de Cartera</Text>
        </View>

        <View style={styles.chartWrapper}>
          <PieChart
            data={chartData}
            donut
            radius={90}
            innerRadius={65}
            centerLabelComponent={() => (
              <View style={{justifyContent: 'center', alignItems: 'center'}}>
                <Text style={{fontSize: 20, color: '#ccd6f6', fontWeight: 'bold'}}>{formatter.format(totalValue).split(',')[0]}€</Text>
                <Text style={{fontSize: 11, color: '#8892b0'}}>Total Cartera</Text>
              </View>
            )}
          />
          
          <View style={styles.legendContainer}>
             {chartData.map((item, index) => (
                <View key={index} style={styles.legendItem}>
                   <View style={[styles.dot, {backgroundColor: item.color}]} />
                   <Text style={styles.legendText}>{item.text}</Text>
                   <Text style={styles.legendPercent}>
                    {((item.value / totalValue) * 100).toFixed(0)}%
                   </Text>
                </View>
             ))}
          </View>
        </View>

        <View style={styles.listSection}>
          {Object.keys(data.portfolio_grouped).map(port => (
            <View key={port} style={styles.groupWrapper}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupTitle}>{port}</Text>
                <View style={styles.groupLine} />
              </View>
              
              {data.portfolio_grouped[port].map(asset => (
                <View key={asset.id} style={styles.assetCard}>
                  <View style={styles.assetMain}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    {asset.profit !== undefined && (
                      <Text style={[styles.assetProfit, { color: asset.profit >= 0 ? '#64ffda' : '#ff6b6b' }]}>
                        {asset.profit >= 0 ? '+' : ''}{formatter.format(asset.profit)}
                      </Text>
                    )}
                  </View>
                  <View style={styles.assetSecondary}>
                    <Text style={styles.assetValue}>{formatter.format(asset.value)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}
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
    marginBottom: 20,
  },
  mainTitle: {
    color: '#ccd6f6',
    fontSize: 32,
    fontWeight: '800',
  },
  chartWrapper: {
    backgroundColor: '#0a192f',
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#233554',
    marginBottom: 30,
  },
  legendContainer: {
    flex: 1,
    marginLeft: 20,
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  legendText: {
    color: '#ccd6f6',
    fontSize: 13,
    flex: 1,
  },
  legendPercent: {
    color: '#8892b0',
    fontSize: 12,
    fontWeight: '600',
  },
  listSection: {
    gap: 25,
  },
  groupWrapper: {
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  groupTitle: {
    color: '#8892b0',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 2,
    marginRight: 10,
  },
  groupLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#112240',
  },
  assetCard: {
    backgroundColor: '#112240',
    borderRadius: 16,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#233554',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assetName: {
    color: '#ccd6f6',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  assetProfit: {
    fontSize: 12,
    fontWeight: '700',
  },
  assetValue: {
    color: '#ccd6f6',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
  }
});

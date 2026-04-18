from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Asset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.String(20))
    asset_name = db.Column(db.String(100))
    portfolio = db.Column(db.String(100)) # CASH, CRYPTO, FUNDS, ETFS, OTROS
    actual_price = db.Column(db.Float)
    avg_buy_price = db.Column(db.Float)
    actual_holdings = db.Column(db.Float)
    total_invest_money = db.Column(db.Float)
    actual_money = db.Column(db.Float)
    profit_loss = db.Column(db.Float)
    profit_loss_pct = db.Column(db.Float)

# Nueva tabla para gestionar qué activos queremos trackear
class AssetConfig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    portfolio = db.Column(db.String(100), nullable=False) # CASH, CRYPTO, FUNDS, ETFS, OTROS
    type = db.Column(db.String(20), default='manual') # 'manual' o 'auto'
    subtype = db.Column(db.String(20), default='market') # 'market', 'cash', 'indexa'
    ticker = db.Column(db.String(50)) # Ticker de Yahoo (ej: VUSA.L) o ID de CoinGecko
    holdings = db.Column(db.Float, default=0.0)
    invested_total = db.Column(db.Float, default=0.0)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow)  # Última actualización manual de holdings

class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    color = db.Column(db.String(20), default='#3B82F6')
    icon = db.Column(db.String(20), default='tag')
    subcategories = db.relationship('Subcategory', backref='category', lazy=True, cascade="all, delete-orphan")

class Subcategory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=False)

class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.DateTime, nullable=False)
    description = db.Column(db.String(255), nullable=False)
    amount = db.Column(db.Float, nullable=False) # Negativo gastos, positivo ingresos
    source = db.Column(db.String(50)) # SANTANDER, REVOLUT, EDENRED
    
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=True)
    subcategory_id = db.Column(db.Integer, db.ForeignKey('subcategory.id'), nullable=True)
    
    raw_text = db.Column(db.Text) # Datos originales del CSV/Excel
    is_reviewed = db.Column(db.Boolean, default=False)
    is_income = db.Column(db.Boolean, default=False)
    
    # Para vincular Bizums a gastos originales (EDENRED) o reembolsos
    linked_transaction_id = db.Column(db.Integer, db.ForeignKey('transaction.id'), nullable=True)
    
    category = db.relationship('Category', foreign_keys=[category_id])
    subcategory = db.relationship('Subcategory', foreign_keys=[subcategory_id])
    linked_transaction = db.relationship('Transaction', remote_side=[id], backref='linked_by')

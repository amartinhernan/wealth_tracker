from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Asset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.String(20))
    asset_name = db.Column(db.String(100))
    portfolio = db.Column(db.String(100))
    actual_price = db.Column(db.Float)
    avg_buy_price = db.Column(db.Float)
    actual_holdings = db.Column(db.Float)
    total_invest_money = db.Column(db.Float)
    actual_money = db.Column(db.Float)
    profit_loss = db.Column(db.Float)
    profit_loss_pct = db.Column(db.Float)

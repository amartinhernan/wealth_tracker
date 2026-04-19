import sqlite3
import os

db_path = 'instance/patrimonio.db'

if not os.path.exists(db_path):
    print(f"Error: {db_path} no existe.")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("--- TABLAS ---")
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    for table in tables:
        print(f"Table: {table[0]}")
        
    print("\n--- SCHEMA CATEGORY ---")
    try:
        cursor.execute("PRAGMA table_info(category);")
        print(cursor.fetchall())
    except:
        print("No category table")
        
    print("\n--- SCHEMA TRANSACTION ---")
    try:
        cursor.execute("PRAGMA table_info('transaction');")
        cols = cursor.fetchall()
        for col in cols:
            print(col)
    except:
        print("No transaction table")
        
    print("\n--- SAMPLE TRANSACTIONS WITH CATEGORIES ---")
    try:
        # Intentar un join para ver qué hay
        cursor.execute("""
            SELECT t.date, t.description, t.amount, c.name, s.name 
            FROM 'transaction' t
            LEFT JOIN category c ON t.category_id = c.id
            LEFT JOIN subcategory s ON t.subcategory_id = s.id
            LIMIT 5
        """)
        rows = cursor.fetchall()
        for row in rows:
            print(row)
    except Exception as e:
        print(f"Error checking data: {e}")
        
    conn.close()

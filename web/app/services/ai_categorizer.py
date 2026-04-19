import os
import json
from groq import Groq
from app.firebase_utils import get_user_subcollection

class AICategorizer:
    def __init__(self):
        self.api_key = os.getenv("GROQ_API_KEY")
        if self.api_key:
            self.client = Groq(api_key=self.api_key)
        else:
            self.client = None

    def get_categories_context(self, uid):
        """Obtiene las categorías y subcategorías de Firestore para un usuario."""
        cat_docs = get_user_subcollection(uid, 'categories').get()
        sub_docs = get_user_subcollection(uid, 'subcategories').get()
        
        # Agrupar subcategorías por ID de categoría
        sub_map = {}
        for s_doc in sub_docs:
            s = s_doc.to_dict()
            c_id = str(s.get('category_id'))
            if c_id not in sub_map: sub_map[c_id] = []
            sub_map[c_id].append(s.get('name'))
            
        context = []
        for c_doc in cat_docs:
            c = c_doc.to_dict()
            subs = sub_map.get(c_doc.id, [])
            context.append(f"- {c['name']}: {', '.join(subs)}")
            
        return "\n".join(context)

    def categorize(self, uid, description, amount):
        if not self.client:
            return None, None

        cat_context = self.get_categories_context(uid)
        
        prompt = f"""
Clasifica el siguiente movimiento bancario en una Categoría y Subcategoría basándote en la lista proporcionada.
Si el movimiento parece una transferencia entre cuentas propias, un traspaso a una plataforma de inversión (Indexa, Binance, etc.) o un ahorro, asígnalo siempre a la categoría "Movimientos".

Responde ÚNICAMENTE con un JSON en este formato: {{"category": "Nombre", "subcategory": "Nombre"}}

Movimiento: "{description}"
Importe: {amount} EUR

Categorías disponibles:
{cat_context}

Reglas críticas:
1. Las transferencias entre bancos o recargas de tarjetas (ej. Revolut, Santander) son "Movimientos" -> "Transferencia Interna".
2. Los envíos de dinero a brokers o exchanges son "Movimientos" -> "Aportación Inversión".
3. Si no estás seguro, elige la que mejor encaje pero prioriza la coherencia con el importe (ej. importes altos redondos suelen ser transferencias).
"""

        try:
            chat_completion = self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "Eres un asistente experto en finanzas personales que clasifica gastos e ingresos."
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="llama-3.3-70b-versatile",
                response_format={"type": "json_object"}
            )
            
            res = json.loads(chat_completion.choices[0].message.content)
            return res.get("category"), res.get("subcategory")
        except Exception as e:
            print(f"Error calling Groq API: {e}")
            return None, None

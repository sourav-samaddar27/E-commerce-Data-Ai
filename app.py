import os
import pandas as pd
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from pandasql import sqldf
import google.generativeai as genai
import json
import time


GEMINI_API_KEY = "**" // add your gemini key


app = Flask(__name__)
CORS(app)  


try:
    genai.configure(api_key=GEMINI_API_KEY)
except Exception as e:
    print(f"Error configuring Gemini API: {e}")


script_dir = os.path.dirname(os.path.abspath(__file__))


ad_sales_path = os.path.join(script_dir, "Product-Level Ad Sales and Metrics (mapped).xlsx")
total_sales_path = os.path.join(script_dir, "Product-Level Total Sales and Metrics (mapped).xlsx")
eligibility_path = os.path.join(script_dir, "Product-Level Eligibility Table (mapped).xlsx")


try:
    ad_sales = pd.read_excel(ad_sales_path)
    total_sales = pd.read_excel(total_sales_path)
    eligibility = pd.read_excel(eligibility_path)
    print("All Excel files loaded successfully.")
except Exception as e:
    print(f"An error occurred reading the Excel files: {e}")
    exit()


pysqldf = lambda q: sqldf(q, globals())


db_schema = """
You are a powerful AI that converts natural language questions into SQL queries.
You have access to three tables (Pandas DataFrames):

1. ad_sales:
   - date (TEXT)
   - item_id (INTEGER)
   - ad_sales (REAL)
   - impressions (INTEGER)
   - ad_spend (REAL)
   - clicks (INTEGER)
   - units_sold (INTEGER)

2. total_sales:
   - date (TEXT)
   - item_id (INTEGER)
   - total_sales (REAL)
   - total_units_ordered (INTEGER)

3. eligibility:
   - eligibility_datetime_utc (TEXT)
   - item_id (INTEGER)
   - eligibility (INTEGER, 1 for True, 0 for False)
   - message (TEXT)

IMPORTANT RULES:
- You MUST only output a valid SQL query.
- Do NOT output Python code, explanations, or any text other than the SQL query itself.
- If the user asks for a calculation, provide the SQL query for that calculation.
- For RoAS (Return on Ad Spend), use the formula: SELECT SUM(ad_sales) / SUM(ad_spend) FROM ad_sales;
- For CPC (Cost Per Click), use the formula: SELECT SUM(ad_spend) / SUM(clicks) FROM ad_sales;
"""

def get_chart_recommendation(question, sql_query, results_df):
    """Determines if a chart is suitable and returns its configuration."""
    if results_df.empty or len(results_df.columns) < 2:
        return {"chart_type": "none"}

    categorical_cols = list(results_df.select_dtypes(include=['object', 'category']).columns)
    numerical_cols = list(results_df.select_dtypes(include=['number']).columns)

    if not categorical_cols or not numerical_cols:
        return {"chart_type": "none"}

    if len(categorical_cols) >= 1 and len(numerical_cols) >= 1:
        if any(keyword in question.lower() for keyword in ['chart', 'graph', 'plot', 'visualize', 'bar', 'pie']):
             return {
                "chart_type": "bar",
                "x_axis": categorical_cols[0],
                "y_axis": numerical_cols[0],
                "title": f"Chart for: {question}"
            }
            
    return {"chart_type": "none"}


# --- Main API Endpoint (Now Streaming) ---
@app.route('/ask')
def ask():
    question = request.args.get('question')
    if not question:
        return Response("Missing question parameter", status=400)

    def generate():
        try:
            #  Generate SQL
            model = genai.GenerativeModel('gemini-2.0-flash')
            # Note the stricter prompt!
            sql_prompt = f"{db_schema}\n\nUser Question: \"{question}\"\n\nSQL Query:"
            
            
            generation_config = genai.types.GenerationConfig(
                candidate_count=1,
                stop_sequences=[';'], 
                temperature=0.0 
            )

            sql_response = model.generate_content(sql_prompt, generation_config=generation_config)

            sql_query = sql_response.text.strip().replace('```sql', '').replace('```', '')
            if not sql_query.endswith(';'):
                sql_query += ';'
            
            yield f"event: sql_generated\ndata: {json.dumps({'sql_query': sql_query})}\n\n"
            time.sleep(0.1)

            #  Execute Query and get Data + Chart Info
            
            results_df = pysqldf(sql_query[:-1]) 
            results_json = results_df.to_dict(orient='records')
            chart_info = get_chart_recommendation(question, sql_query, results_df)

            yield f"event: data_retrieved\ndata: {json.dumps({'results': results_json, 'chart_info': chart_info})}\n\n"
            time.sleep(0.1)

            # Stream Summary
            summary_model = genai.GenerativeModel('gemini-2.0-flash')
            summary_prompt = f"User question: \"{question}\"\nData:\n{results_df.to_string()}\n\nProvide a concise, friendly answer in HTML format:"
            summary_stream = summary_model.generate_content(summary_prompt, stream=True)
            
            for chunk in summary_stream:
                clean_chunk = chunk.text.replace('\n', '<br>')
                yield f"event: summary_chunk\ndata: {json.dumps({'chunk': clean_chunk})}\n\n"
                time.sleep(0.05)

            yield "event: stream_end\ndata: {}\n\n"

        except Exception as e:
            print(f"Error during stream: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return Response(generate(), mimetype='text/event-stream')

if __name__ == '__main__':
    app.run(debug=True)

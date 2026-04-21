import pandas as pd
import plotly.graph_objects as go
from dash import Dash, Input, Output, State, callback, dcc, html

# ── 数据 ──────────────────────────────────────────────────────────────────────
df = pd.read_csv("data/log0guide_info.csv")
df.columns = df.columns.str.strip()
df["seq"] = range(len(df))

DATA_COLS = [
    "mount_yaw", "mount_pitch",
    "track_yaw_speed", "track_pitch_speed",
    "track_yaw_speed_offset", "track_pitch_speed_offset",
    "track_yaw_final_speed", "track_pitch_final_speed",
]
COL_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
]

X_MIN, X_MAX = int(df["seq"].min()), int(df["seq"].max())

def col_y_range(cols: list[str]) -> tuple[float, float]:
    if not cols:
        return -1.0, 1.0
    lo = min(df[c].min() for c in cols)
    hi = max(df[c].max() for c in cols)
    pad = (hi - lo) * 0.05 or 0.1
    return round(lo - pad, 6), round(hi + pad, 6)

# ── 布局 ──────────────────────────────────────────────────────────────────────
_label_style = {"fontSize": 13, "color": "#555", "marginBottom": 4}
_input_style = {
    "width": "90px", "padding": "4px 8px",
    "border": "1px solid #ccc", "borderRadius": 4,
    "fontSize": 13,
}

app = Dash(__name__)
app.title = "导星引导日志分析"

app.layout = html.Div(
    style={"fontFamily": "Microsoft YaHei, Arial", "padding": "16px 24px", "background": "#f7f8fa", "minHeight": "100vh"},
    children=[
        html.H2("导星引导日志 — 交互式分析", style={"marginBottom": 16, "color": "#222"}),

        # ── 控制面板 ──────────────────────────────────────────────────────────
        html.Div(
            style={
                "display": "flex", "flexWrap": "wrap", "gap": 24,
                "background": "#fff", "borderRadius": 8,
                "padding": "16px 20px", "marginBottom": 16,
                "boxShadow": "0 1px 4px rgba(0,0,0,.08)",
            },
            children=[
                # 纵轴数据选择
                html.Div([
                    html.Div("纵轴数据（可多选）", style=_label_style),
                    dcc.Dropdown(
                        id="y-cols",
                        options=[{"label": c, "value": c} for c in DATA_COLS],
                        value=["mount_yaw", "mount_pitch"],
                        multi=True,
                        clearable=False,
                        style={"width": 520, "fontSize": 13},
                    ),
                ]),

                # X 范围
                html.Div([
                    html.Div("横轴范围", style=_label_style),
                    html.Div(
                        style={"display": "flex", "alignItems": "center", "gap": 8},
                        children=[
                            dcc.Input(id="x-min", type="number", value=X_MIN,
                                      placeholder="最小", style=_input_style),
                            html.Span("~", style={"color": "#888"}),
                            dcc.Input(id="x-max", type="number", value=X_MAX,
                                      placeholder="最大", style=_input_style),
                        ],
                    ),
                ]),

                # Y 范围
                html.Div([
                    html.Div("纵轴范围", style=_label_style),
                    html.Div(
                        style={"display": "flex", "alignItems": "center", "gap": 8},
                        children=[
                            dcc.Input(id="y-min", type="number",
                                      placeholder="自动", style=_input_style),
                            html.Span("~", style={"color": "#888"}),
                            dcc.Input(id="y-max", type="number",
                                      placeholder="自动", style=_input_style),
                        ],
                    ),
                    html.Div(
                        html.Button("自动", id="btn-auto-y",
                                    style={"marginTop": 6, "padding": "3px 12px",
                                           "cursor": "pointer", "fontSize": 12,
                                           "border": "1px solid #bbb", "borderRadius": 4,
                                           "background": "#f0f0f0"}),
                    ),
                ]),

                # 线宽 & 模式
                html.Div([
                    html.Div("线条宽度", style=_label_style),
                    html.Div(
                        dcc.Slider(id="line-width", min=0.5, max=4, step=0.5, value=1.5,
                                   marks={i: str(i) for i in [0.5, 1, 1.5, 2, 3, 4]},
                                   tooltip={"always_visible": False}),
                        style={"width": 200},
                    ),
                    html.Div("显示模式", style={**_label_style, "marginTop": 10}),
                    dcc.RadioItems(
                        id="draw-mode",
                        options=[
                            {"label": "折线", "value": "lines"},
                            {"label": "折线+点", "value": "lines+markers"},
                            {"label": "仅点", "value": "markers"},
                        ],
                        value="lines",
                        inline=True,
                        inputStyle={"marginRight": 4},
                        labelStyle={"marginRight": 14, "fontSize": 13},
                    ),
                ]),
            ],
        ),

        # ── 图表 ──────────────────────────────────────────────────────────────
        dcc.Graph(
            id="main-chart",
            config={
                "scrollZoom": True,
                "displayModeBar": True,
                "modeBarButtonsToAdd": ["drawline", "eraseshape"],
                "toImageButtonOptions": {"format": "png", "filename": "guide_log"},
            },
            style={"height": "62vh"},
        ),

        # ── 范围滑块（联动横轴）──────────────────────────────────────────────
        html.Div(
            style={"background": "#fff", "borderRadius": 8, "padding": "12px 20px",
                   "marginTop": 8, "boxShadow": "0 1px 4px rgba(0,0,0,.08)"},
            children=[
                html.Div("横轴快速范围", style={**_label_style, "marginBottom": 8}),
                dcc.RangeSlider(
                    id="x-slider",
                    min=X_MIN, max=X_MAX,
                    value=[X_MIN, X_MAX],
                    step=1,
                    marks={i: str(i) for i in range(X_MIN, X_MAX + 1, max(1, (X_MAX - X_MIN) // 10))},
                    tooltip={"placement": "bottom", "always_visible": True},
                    allowCross=False,
                ),
            ],
        ),
    ],
)

# ── 滑块 → 同步输入框 ─────────────────────────────────────────────────────────
@callback(
    Output("x-min", "value"),
    Output("x-max", "value"),
    Input("x-slider", "value"),
    prevent_initial_call=True,
)
def slider_to_inputs(slider_val: list[int]) -> tuple[int, int]:
    return slider_val[0], slider_val[1]


# ── 自动 Y 范围 ───────────────────────────────────────────────────────────────
@callback(
    Output("y-min", "value"),
    Output("y-max", "value"),
    Input("btn-auto-y", "n_clicks"),
    State("y-cols", "value"),
    prevent_initial_call=True,
)
def auto_y_range(_n: int | None, cols: list[str]) -> tuple[float, float]:
    return col_y_range(cols)


# ── 主图回调 ──────────────────────────────────────────────────────────────────
@callback(
    Output("main-chart", "figure"),
    Input("y-cols", "value"),
    Input("x-min", "value"),
    Input("x-max", "value"),
    Input("y-min", "value"),
    Input("y-max", "value"),
    Input("line-width", "value"),
    Input("draw-mode", "value"),
)
def update_chart(
    y_cols: list[str],
    x_min: int | None,
    x_max: int | None,
    y_min: float | None,
    y_max: float | None,
    line_width: float,
    draw_mode: str,
) -> go.Figure:
    x_lo = x_min if x_min is not None else X_MIN
    x_hi = x_max if x_max is not None else X_MAX

    mask = (df["seq"] >= x_lo) & (df["seq"] <= x_hi)
    sub = df[mask]

    fig = go.Figure()
    for i, col in enumerate(y_cols or []):
        color = COL_COLORS[i % len(COL_COLORS)]
        fig.add_trace(go.Scatter(
            x=sub["seq"], y=sub[col],
            mode=draw_mode,
            name=col,
            line=dict(color=color, width=line_width),
            marker=dict(color=color, size=4),
            hovertemplate=f"<b>{col}</b><br>seq=%{{x}}<br>值=%{{y:.5f}}<extra></extra>",
        ))

    # y 轴范围
    if y_min is not None and y_max is not None and y_min < y_max:
        y_range = [y_min, y_max]
    else:
        auto_lo, auto_hi = col_y_range(y_cols or [])
        y_range = [auto_lo, auto_hi]

    fig.update_layout(
        margin=dict(l=60, r=20, t=30, b=50),
        template="plotly_white",
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="right", x=1),
        xaxis=dict(title="采样序号", range=[x_lo, x_hi], showgrid=True, gridcolor="#eee"),
        yaxis=dict(title="数值", range=y_range, showgrid=True, gridcolor="#eee"),
        font=dict(family="Microsoft YaHei, Arial", size=12),
    )
    return fig


# ── 启动 ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import webbrowser, threading, time

    def _open():
        time.sleep(1.2)
        webbrowser.open("http://127.0.0.1:8050")

    threading.Thread(target=_open, daemon=True).start()
    print("🚀  启动中 → http://127.0.0.1:8050")
    app.run(debug=False)

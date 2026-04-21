import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# ── 读取数据 ──────────────────────────────────────────────────────────────────
df = pd.read_csv("data/log0guide_info.csv")
df.columns = df.columns.str.strip()

# 自增序号作为横轴
df["seq"] = range(len(df))
x = df["seq"]
x_title = "采样序号"

# ── 创建子图布局 ──────────────────────────────────────────────────────────────
fig = make_subplots(
    rows=3, cols=2,
    shared_xaxes=True,
    subplot_titles=(
        "云台 Yaw 角度",        "云台 Pitch 角度",
        "跟踪 Yaw / Pitch 速度", "速度偏移量 (Yaw / Pitch)",
        "最终速度 Yaw",          "最终速度 Pitch",
    ),
    vertical_spacing=0.10,
    horizontal_spacing=0.08,
)

# 配色
COLORS = {
    "yaw":        "#1f77b4",
    "pitch":      "#ff7f0e",
    "yaw_off":    "#2ca02c",
    "pitch_off":  "#d62728",
    "yaw_final":  "#9467bd",
    "pitch_final":"#8c564b",
}


def line(y_col, color, name, row, col, dash="solid"):
    return fig.add_trace(
        go.Scatter(
            x=x, y=df[y_col],
            mode="lines",
            name=name,
            line=dict(color=color, width=1.2, dash=dash),
            hovertemplate=f"<b>{name}</b><br>x=%{{x}}<br>y=%{{y:.4f}}<extra></extra>",
        ),
        row=row, col=col,
    )


# Row 1 — 角度
line("mount_yaw",   COLORS["yaw"],   "mount_yaw",   1, 1)
line("mount_pitch", COLORS["pitch"], "mount_pitch", 1, 2)

# Row 2 — 速度 & 偏移
line("track_yaw_speed",         COLORS["yaw"],      "yaw_speed",         2, 1)
line("track_pitch_speed",       COLORS["pitch"],    "pitch_speed",       2, 1, dash="dot")
line("track_yaw_speed_offset",  COLORS["yaw_off"],  "yaw_offset",        2, 2)
line("track_pitch_speed_offset",COLORS["pitch_off"],"pitch_offset",      2, 2, dash="dot")

# Row 3 — 最终速度
line("track_yaw_final_speed",   COLORS["yaw_final"],   "yaw_final_speed",   3, 1)
line("track_pitch_final_speed", COLORS["pitch_final"], "pitch_final_speed", 3, 2)

# ── 布局美化 ──────────────────────────────────────────────────────────────────
fig.update_layout(
    title=dict(
        text="<b>导星引导日志 — 交互式分析</b>",
        x=0.5, font=dict(size=20)
    ),
    height=900,
    template="plotly_white",
    hovermode="x unified",
    legend=dict(orientation="h", yanchor="bottom", y=1.01, xanchor="right", x=1),
    font=dict(family="Microsoft YaHei, Arial", size=12),
)

# x 轴标题只在最后一行显示
for col in (1, 2):
    fig.update_xaxes(title_text=x_title, row=3, col=col)

# y 轴单位标注
for row, unit in [(1, "度 (°)"), (2, "°/s"), (3, "°/s")]:
    for col in (1, 2):
        fig.update_yaxes(title_text=unit, row=row, col=col)

# ── 导出 HTML ─────────────────────────────────────────────────────────────────
out_path = "guide_viz.html"
fig.write_html(out_path, include_plotlyjs="cdn")
print(f"✅  已生成：{out_path}")
print("   用浏览器打开即可交互（缩放、平移、悬停查看数值）")

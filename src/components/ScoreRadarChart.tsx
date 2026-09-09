'use client';

import React from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';

ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

interface ScoreCarmentor {
  fiabilidad_mecanica: number;
  coste_mantenimiento: number;
  precio_vs_mercado: number;
  consumo_eficiencia: number;
  score_global: number;
}

interface ScoreRadarChartProps {
  score: ScoreCarmentor;
  /** Theme overrides (default = consumer navy on light). */
  accentColor?: string;
  fillColor?: string;
  gridColor?: string;
  labelColor?: string;
  /** Center score number color; falls back to the default className when unset. */
  centerColor?: string;
  /** Height utility for the wrapper. Default fills a tall consumer card; dealer
   *  contexts pass `h-full` so the chart fits its own square box instead of being
   *  clipped by a fixed 400px height. */
  heightClass?: string;
  /** Hide the per-axis labels entirely (for tiny/peek renders). */
  showLabels?: boolean;
  /** Label with just the metric name instead of "Name: 82/100" (fits small boxes). */
  compactLabels?: boolean;
  /** Class for the centered global-score number (shrink it in compact renders). */
  centerClassName?: string;
}

export function ScoreRadarChart({
  score,
  accentColor = '#042152',
  fillColor = 'rgba(4, 33, 82, 0.15)',
  gridColor = 'rgba(0, 0, 0, 0.08)',
  labelColor = '#042152',
  centerColor,
  heightClass = 'h-[400px]',
  showLabels = true,
  compactLabels = false,
  centerClassName = 'text-4xl',
}: ScoreRadarChartProps) {
  const metrics = [
    { label: 'Fiabilidad', value: score.fiabilidad_mecanica },
    { label: 'Mantenimiento', value: score.coste_mantenimiento },
    { label: 'Precio', value: score.precio_vs_mercado },
    { label: 'Consumo', value: score.consumo_eficiencia },
  ];

  const data = {
    labels: metrics.map(m => (compactLabels ? m.label : `${m.label}: ${m.value}/100`)),
    datasets: [
      {
        label: 'Score CarMentor',
        data: metrics.map(m => m.value),
        backgroundColor: fillColor,
        borderColor: accentColor,
        borderWidth: 2,
        pointBackgroundColor: accentColor,
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: accentColor,
        pointRadius: 4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: showLabels ? 4 : 2,
    },
    scales: {
      r: {
        beginAtZero: true,
        max: 100,
        min: 0,
        ticks: {
          display: false,
          stepSize: 20,
        },
        grid: {
          color: gridColor,
        },
        angleLines: {
          color: gridColor,
        },
        pointLabels: {
          display: showLabels,
          font: {
            size: 10,
            weight: 500 as const,
          },
          color: labelColor,
          padding: 4,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            return `${context.parsed.r}/100`;
          },
        },
      },
    },
  };

  return (
    <div className={`relative w-full ${heightClass} overflow-hidden`} style={{ maxWidth: '100%', width: '100%', minWidth: 0 }}>
      <div style={{ width: '100%', height: '100%', position: 'relative', minWidth: 0 }}>
        <Radar data={data} options={options} />
      </div>
      {/* Center score display */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div className="text-center leading-none">
          <div className={`${centerClassName} font-bold text-foreground`} style={centerColor ? { color: centerColor } : undefined}>
            {score.score_global.toFixed(1)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5" style={centerColor ? { color: centerColor, opacity: 0.6 } : undefined}>/10</div>
        </div>
      </div>
    </div>
  );
}

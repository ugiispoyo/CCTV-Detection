import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "../components/layout/app-shell";
import { LoadingState } from "../components/ui/states";
import { useRealtime } from "../hooks/use-realtime";
import { GlobalPersonCaptureReview } from "../features/person-labeling/global-person-capture-review";

const OverviewPage = lazy(() => import("../pages/overview-page").then((module) => ({ default: module.OverviewPage })));
const LiveMonitoringPage = lazy(() => import("../pages/live-monitoring-page").then((module) => ({ default: module.LiveMonitoringPage })));
const CamerasPage = lazy(() => import("../pages/cameras-page").then((module) => ({ default: module.CamerasPage })));
const DetectionsPage = lazy(() => import("../pages/detections-page").then((module) => ({ default: module.DetectionsPage })));
const PersonLabelingPage = lazy(() => import("../pages/person-labeling-page").then((module) => ({ default: module.PersonLabelingPage })));
const StatisticsPage = lazy(() => import("../pages/statistics-page").then((module) => ({ default: module.StatisticsPage })));
const NotFoundPage = lazy(() => import("../pages/not-found-page").then((module) => ({ default: module.NotFoundPage })));

export function App() {
  useRealtime();
  return <><GlobalPersonCaptureReview /><Suspense fallback={<LoadingState label="Loading page" />}><Routes><Route element={<AppShell />}><Route index element={<OverviewPage />} /><Route path="live" element={<LiveMonitoringPage />} /><Route path="cameras" element={<CamerasPage />} /><Route path="detections" element={<DetectionsPage />} /><Route path="person-labeling" element={<PersonLabelingPage />} /><Route path="statistics" element={<StatisticsPage />} /><Route path="*" element={<NotFoundPage />} /></Route></Routes></Suspense></>;
}

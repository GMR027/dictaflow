{{- define "dictaflow-site.name" -}}{{ .Chart.Name }}{{- end }}
{{- define "dictaflow-site.labels" -}}
app.kubernetes.io/name: {{ include "dictaflow-site.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
{{- define "dictaflow-site.selector" -}}
app.kubernetes.io/name: {{ include "dictaflow-site.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
{{/* APK de Android: pods propios (otro nombre), para que el Service de la web no los seleccione. */}}
{{- define "dictaflow-site.androidSelector" -}}
app.kubernetes.io/name: {{ include "dictaflow-site.name" . }}-android
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

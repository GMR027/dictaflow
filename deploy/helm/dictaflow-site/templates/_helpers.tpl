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

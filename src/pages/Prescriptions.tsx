import { useCallback, useRef, useState, type DragEvent } from 'react'
import { getDocs, limit, query, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { collection } from 'firebase/firestore'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../context/AuthProvider'
import { useToast } from '../context/ToastProvider'
import { usePrescriptions } from '../lib/data'
import { api, errorMessage } from '../lib/api'
import { bytes, formatDateTime } from '../lib/format'
import type { Prescription } from '../types'
import { Icon } from '../components/Icons'
import {
  Badge,
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  cx,
} from '../components/ui'

const MAX_BYTES = 10 * 1024 * 1024
const KINDS = [
  { value: 'prescription', label: 'Prescription' },
  { value: 'report', label: 'Lab report' },
  { value: 'photo', label: 'Medicine photo' },
  { value: 'other', label: 'Other document' },
]
const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map((k) => [k.value, k.label]))

interface UploadItem {
  key: string
  name: string
  progress: number
  state: 'uploading' | 'processing' | 'done' | 'error'
  error?: string
}

export function PrescriptionsPage() {
  const { user, activeUserId, profile, isCaregiverView } = useAuth()
  const { toast } = useToast()
  const prescriptions = usePrescriptions(activeUserId)
  const [kind, setKind] = useState('prescription')
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [drag, setDrag] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Prescription | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const updateUpload = useCallback((key: string, patch: Partial<UploadItem>) => {
    setUploads((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }, [])

  const waitForIndex = useCallback(async (storagePath: string) => {
    const startedAt = Date.now()
    while (Date.now() - startedAt < 20_000) {
      const snapshot = await getDocs(
        query(collection(db, 'prescriptions'), where('storagePath', '==', storagePath), limit(1)),
      )
      if (!snapshot.empty) return snapshot.docs[0].id
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    }
    return null
  }, [])

  const uploadOne = useCallback(
    async (file: File) => {
      if (!user || !activeUserId) return
      const key = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      setUploads((current) => [
        ...current,
        { key, name: file.name, progress: 0, state: 'uploading' },
      ])

      if (file.size > MAX_BYTES) {
        updateUpload(key, { state: 'error', error: 'Files must be under 10 MB.' })
        return
      }
      const validType = file.type === 'application/pdf' || file.type.startsWith('image/')
      if (!validType) {
        updateUpload(key, { state: 'error', error: 'Only images and PDFs are accepted.' })
        return
      }

      const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80)
      const storagePath = `prescriptions/${activeUserId}/${Date.now()}_${safeName}`

      try {
        const task = uploadBytesResumable(ref(storage, storagePath), file, {
          contentType: file.type || 'application/octet-stream',
          customMetadata: { kind, uploadedBy: user.uid },
        })

        await new Promise<void>((resolve, reject) => {
          task.on(
            'state_changed',
            (snapshot) => {
              const percent = snapshot.totalBytes
                ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
                : 0
              updateUpload(key, { progress: percent })
            },
            (err) => reject(err),
            () => resolve(),
          )
        })

        updateUpload(key, { state: 'processing', progress: 100 })
        const id = await waitForIndex(storagePath)

        if (id) {
          updateUpload(key, { state: 'done' })
          toast(`${file.name} uploaded and indexed.`, 'success')
          window.setTimeout(() => {
            setUploads((current) => current.filter((item) => item.key !== key))
          }, 2200)
        } else {
          updateUpload(key, {
            state: 'error',
            error: 'Stored, but the Cloud Function did not index it. Check the functions log.',
          })
        }
      } catch (err) {
        updateUpload(key, { state: 'error', error: errorMessage(err) })
      }
    },
    [user, activeUserId, kind, updateUpload, waitForIndex, toast],
  )

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    for (const file of Array.from(files).slice(0, 5)) {
      await uploadOne(file)
    }
    if (inputRef.current) inputRef.current.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDrag(false)
    if (isCaregiverView) return
    void onFiles(event.dataTransfer.files)
  }

  async function openFile(item: Prescription) {
    setOpeningId(item.id)
    try {
      const url = await getDownloadURL(ref(storage, item.storagePath))
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setOpeningId(null)
    }
  }

  async function remove() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await api.deletePrescription(deleteTarget.id)
      toast('Prescription deleted from Cloud Storage.', 'success')
      setDeleteTarget(null)
    } catch (err) {
      toast(errorMessage(err), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Prescriptions & reports"
        subtitle="Files go straight to Cloud Storage; a Storage-triggered Cloud Function indexes them in Firestore."
        actions={<Badge tone="brand">Max 10 MB · images & PDF</Badge>}
      />

      <div className="grid" style={{ gap: 16 }}>
        {!isCaregiverView ? (
          <Card className="card-pad">
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ maxWidth: 220, flex: 1 }}>
                <Field label="Document type" htmlFor="upload-kind">
                  <Select id="upload-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                    {KINDS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div style={{ flex: 2, minWidth: 220, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
                Binary content never passes through a server. The browser writes directly to Storage,
                and the <span className="mono">onPrescriptionUploaded</span> trigger creates the Firestore
                record — a clean example of event-driven cloud architecture.
              </div>
            </div>

            <div
              className={cx('dropzone', drag && 'drag')}
              onDragOver={(event) => {
                event.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
              }}
            >
              <div className="big">
                <Icon name="upload" size={21} />
              </div>
              <h3>Drop a prescription here, or click to browse</h3>
              <p>PDF, JPG, PNG · up to 10 MB · stored at prescriptions/{activeUserId?.slice(0, 8)}…/</p>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,image/*"
                multiple
                hidden
                onChange={(event) => void onFiles(event.target.files)}
              />
            </div>

            {uploads.length > 0 ? (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {uploads.map((item) => (
                  <div key={item.key} className="card card-pad" style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div className="file-icon">
                        <Icon name={item.state === 'error' ? 'alert' : 'file'} size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.8, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name}
                        </div>
                        <div style={{ fontSize: 11.5, color: item.state === 'error' ? 'var(--red-fg)' : 'var(--muted)' }}>
                          {item.state === 'uploading'
                            ? `Uploading to Cloud Storage… ${item.progress}%`
                            : item.state === 'processing'
                              ? 'Uploaded · waiting for the Storage trigger to index it…'
                              : item.state === 'done'
                                ? 'Indexed in Firestore ✓'
                                : item.error}
                        </div>
                        {item.state === 'uploading' ? (
                          <div className="upload-progress">
                            <span style={{ width: `${item.progress}%` }} />
                          </div>
                        ) : null}
                      </div>
                      {item.state === 'processing' ? <span className="spinner" /> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardHead
            title="Your documents"
            subtitle={
              prescriptions === null
                ? 'Loading…'
                : `${prescriptions.length} file${prescriptions.length === 1 ? '' : 's'} in Cloud Storage`
            }
            actions={<Badge tone="default">Prescriptions</Badge>}
          />
          {prescriptions === null ? (
            <div style={{ padding: 18, display: 'grid', gap: 10 }}>
              <Skeleton height={46} />
              <Skeleton height={46} />
            </div>
          ) : prescriptions.length === 0 ? (
            <EmptyState
              icon="file"
              title="No documents yet"
              message={
                isCaregiverView
                  ? 'This patient has not uploaded any prescriptions or reports.'
                  : 'Upload a prescription photo or a lab report PDF. It is stored privately and only you (and your caregivers) can open it.'
              }
            />
          ) : (
            <div className="list">
              {prescriptions.map((item) => {
                const isPdf = item.contentType === 'application/pdf'
                return (
                  <div key={item.id} className="list-row">
                    <div className={cx('file-icon', isPdf ? 'pdf' : 'image')}>
                      <Icon name="file" size={17} />
                    </div>
                    <div className="grow">
                      <div className="title">
                        {item.fileName}
                        <Badge tone={isPdf ? 'red' : 'blue'}>{isPdf ? 'PDF' : 'Image'}</Badge>
                        {item.kind ? <Badge>{KIND_LABEL[item.kind] || item.kind}</Badge> : null}
                      </div>
                      <div className="sub">
                        {bytes(item.size)} · {formatDateTime(item.uploadedAt, profile?.timezone)}
                      </div>
                      <div className="mono" style={{ color: 'var(--muted-2)', marginTop: 3, fontSize: 10.5 }}>
                        {item.storagePath}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="external"
                        loading={openingId === item.id}
                        onClick={() => void openFile(item)}
                      >
                        Open
                      </Button>
                      {!isCaregiverView ? (
                        <button
                          type="button"
                          className="mini-btn danger"
                          aria-label={`Delete ${item.fileName}`}
                          onClick={() => setDeleteTarget(item)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {!isCaregiverView ? (
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title={`Delete ${deleteTarget?.fileName || 'this file'}?`}
          message="The object is removed from Cloud Storage and its Firestore index entry is deleted. The link will stop working immediately."
          loading={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={remove}
        />
      ) : null}
    </>
  )
}

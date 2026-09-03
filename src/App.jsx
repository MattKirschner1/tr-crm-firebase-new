import React, { useState, useEffect } from 'react'
import { auth, db } from './firebase-config'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth'
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore'
import * as XLSX from 'xlsx'

const ADMIN_EMAIL = 'matt@talentresources.com'

const DEAL_STATUSES = [
  'Qualified Lead',
  'Initial Outreach',
  'Client Review',
  'Offer Submitted',
  'Offer Accepted',
  'Contract Signed',
  'Closed Won',
  'Closed Lost'
]

const sendPasswordResetEmail_helper = async (email) => {
  try {
    await sendPasswordResetEmail(auth, email)
    return true
  } catch (error) {
    throw error
  }
}

const formatCurrency = (amount) => {
  const num = Math.abs(amount)
  if (num >= 1000000) {
    return (amount / 1000000).toFixed(1) + 'M'
  }
  if (num >= 1000) {
    return (amount / 1000).toFixed(1) + 'K'
  }
  return amount.toFixed(0)
}

const getQuarterYear = (date) => {
  const d = new Date(date)
  const quarter = Math.ceil((d.getMonth() + 1) / 3)
  return `Q${quarter} ${d.getFullYear()}`
}

function App() {
  const [user, setUser] = useState(null)
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [deals, setDeals] = useState([])
  const [contacts, setContacts] = useState([])
  const [prClients, setPrClients] = useState([])
  
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState({ talent: true, pr: false })
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [userProfile, setUserProfile] = useState(null)

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser)
      if (currentUser) {
        loadDeals()

        const isAdmin = currentUser.email === ADMIN_EMAIL
        loadContacts(currentUser.uid, isAdmin)
        loadPRClients()

        // Track last login and check profile completion
        try {
          const usersQuery = query(collection(db, 'users'), where('uid', '==', currentUser.uid))
          const snapshot = await getDocs(usersQuery)
          if (snapshot.docs.length > 0) {
            const userDoc = snapshot.docs[0]
            const userData = userDoc.data()
            setUserProfile(userData)

            // Show profile completion modal if user doesn't have a name
            if (!userData.name || userData.name.trim() === '') {
              setShowProfileModal(true)
            }

            await updateDoc(doc(db, 'users', userDoc.id), {
              lastLogin: new Date()
            })
          }
        } catch (error) {
          console.error('Error updating last login:', error)
        }
      }
      setLoading(false)
    })
    return () => unsubscribe()
  }, [])

  const loadDeals = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'deals'))
      const deals = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      deals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      setDeals(deals)
    } catch (error) {
      console.error('Error loading deals:', error)
    }
  }

  const loadContacts = async (userId, isAdmin) => {
    try {
      let q
      if (isAdmin) {
        q = query(collection(db, 'contacts'))
      } else {
        q = query(collection(db, 'contacts'), where('userId', '==', userId))
      }
      const snapshot = await getDocs(q)
      const contactList = snapshot.docs.map(c => ({ id: c.id, ...c.data() }))
      contactList.sort((a, b) => a.name.localeCompare(b.name))
      setContacts(contactList)
    } catch (error) {
      console.error('Error loading contacts:', error)
    }
  }

  const loadPRClients = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'prClients'))
      const clients = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      clients.sort((a, b) => a.clientName.localeCompare(b.clientName))
      setPrClients(clients)
    } catch (error) {
      console.error('Error loading PR clients:', error)
    }
  }

  const downloadFile = (file) => {
    if (!file.dataUrl) return
    const link = document.createElement('a')
    link.href = file.dataUrl
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportContactsAsCSV = () => {
    if (contacts.length === 0) {
      alert('No contacts to export')
      return
    }
    const headers = ['Name', 'Email', 'Phone', 'Company', 'Title', 'Type', 'Notes']
    const rows = contacts.map(c => [
      c.name || '',
      c.email || '',
      c.phone || '',
      c.company || '',
      c.title || '',
      c.type || '',
      c.notes || ''
    ])
    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `contacts-${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const exportDocuments = () => {
    const allFiles = []
    deals.forEach(deal => {
      if (deal.fileAttachments && Array.isArray(deal.fileAttachments)) {
        deal.fileAttachments.forEach(file => {
          if (file.uploadedBy !== user.email || user.email === ADMIN_EMAIL) {
            allFiles.push({
              ...file,
              dealBrand: deal.brand,
              dealTalent: deal.talent
            })
          }
        })
      }
    })

    if (allFiles.length === 0) {
      alert('No documents available to export')
      return
    }

    allFiles.forEach(file => {
      if (file.dataUrl) {
        const link = document.createElement('a')
        link.href = file.dataUrl
        link.download = file.name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    })
  }

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (!user) {
    return <LoginPage onLogin={setUser} />
  }

  const isAdmin = user.email === ADMIN_EMAIL

  const handleProfileModalSave = async (fullName) => {
    try {
      const usersQuery = query(collection(db, 'users'), where('uid', '==', user.uid))
      const snapshot = await getDocs(usersQuery)
      if (snapshot.docs.length > 0) {
        const userDoc = snapshot.docs[0]
        await updateDoc(doc(db, 'users', userDoc.id), {
          name: fullName
        })
        setShowProfileModal(false)
        setUserProfile({ ...userProfile, name: fullName })
      }
    } catch (error) {
      console.error('Error saving profile:', error)
    }
  }

  return (
    <div className="app">
      {showProfileModal && <ProfileCompletionModal user={user} onSave={handleProfileModalSave} />}
      <nav className={`navbar ${menuOpen ? 'open' : ''}`}>
        <div className="navbar-brand">
          <div className="logo-small">TR</div>
          <span className="brand-text">Talent Resources</span>
        </div>
        <div className="nav-menu">
          {/* TALENT PROCUREMENT SECTION */}
          <button
            className="nav-section-header"
            onClick={() => setExpandedSections({ ...expandedSections, talent: !expandedSections.talent })}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: '600', width: '100%' }}
          >
            <span>{expandedSections.talent ? '▼' : '▶'}</span>
            <span>💼 Talent Procurement</span>
          </button>
          {expandedSections.talent && (
            <>
              <button
                className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('dashboard'); setMenuOpen(false) }}
              >
                📊 <span>Dashboard</span>
              </button>
              <button
                className={`nav-item ${currentPage === 'deals' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('deals'); setMenuOpen(false) }}
              >
                💼 <span>Deals</span>
              </button>
              <button
                className={`nav-item ${currentPage === 'filesearch' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('filesearch'); setMenuOpen(false) }}
              >
                🔍 <span>File Search</span>
              </button>
            </>
          )}

          {/* PUBLIC RELATIONS SECTION */}
          <button
            className="nav-section-header"
            onClick={() => setExpandedSections({ ...expandedSections, pr: !expandedSections.pr })}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: '600', width: '100%', marginTop: '8px' }}
          >
            <span>{expandedSections.pr ? '▼' : '▶'}</span>
            <span>📢 Public Relations</span>
          </button>
          {expandedSections.pr && (
            <>
              <button
                className={`nav-item ${currentPage === 'pr-clients' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('pr-clients'); setMenuOpen(false) }}
              >
                🤝 <span>Current Clients</span>
              </button>
              <button
                className={`nav-item ${currentPage === 'pr-dashboard' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('pr-dashboard'); setMenuOpen(false) }}
              >
                📈 <span>Revenue Dashboard</span>
              </button>
              <button
                className={`nav-item ${currentPage === 'pr-alerts' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('pr-alerts'); setMenuOpen(false) }}
              >
                ⏰ <span>Contract Alerts</span>
              </button>
              <button
                className={`nav-item ${currentPage === 'pr-filesearch' ? 'active' : ''}`}
                onClick={() => { setCurrentPage('pr-filesearch'); setMenuOpen(false) }}
              >
                🔍 <span>File Search</span>
              </button>
            </>
          )}

          {/* SEPARATE SECTION - Contacts, Team, Usage */}
          <div style={{ borderTop: '1px solid var(--gray-300)', marginTop: '16px', paddingTop: '12px' }}>
            <button
              className={`nav-item ${currentPage === 'contacts' ? 'active' : ''}`}
              onClick={() => { setCurrentPage('contacts'); setMenuOpen(false) }}
            >
              👥 <span>Contacts</span>
            </button>
            {isAdmin && (
              <>
                <button
                  className={`nav-item ${currentPage === 'users' ? 'active' : ''}`}
                  onClick={() => { setCurrentPage('users'); setMenuOpen(false) }}
                >
                  👨‍💼 <span>Team</span>
                </button>
                <button
                  className={`nav-item ${currentPage === 'usage' ? 'active' : ''}`}
                  onClick={() => { setCurrentPage('usage'); setMenuOpen(false) }}
                >
                  📊 <span>Usage</span>
                </button>
              </>
            )}
            <button
              className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`}
              onClick={() => { setCurrentPage('settings'); setMenuOpen(false) }}
            >
              ⚙️ <span>Account Settings</span>
            </button>
          </div>
        </div>
        <div className="navbar-user">
          <div className="user-info">
            <p className="user-name">{user.displayName || 'User'}</p>
            <p className="user-email">{user.email}</p>
            {isAdmin && <p style={{ fontSize: '12px', color: 'var(--primary)', marginTop: '4px' }}>Admin</p>}
          </div>
          <button className="btn-logout" onClick={() => signOut(auth)}>🚪</button>
        </div>
      </nav>

      <main className="main-content">
        {currentPage === 'dashboard' && <Dashboard deals={deals} contacts={contacts} isAdmin={isAdmin} />}
        {currentPage === 'deals' && <DealsPage deals={deals} contacts={contacts} user={user} isAdmin={isAdmin} onReload={loadDeals} onContactAdded={() => loadContacts(user.uid, isAdmin)} downloadFile={downloadFile}  />}
        {currentPage === 'contacts' && <ContactsPage contacts={contacts} user={user} onReload={() => loadContacts(user.uid, isAdmin)} isAdmin={isAdmin} exportContactsAsCSV={exportContactsAsCSV} />}
        {currentPage === 'filesearch' && <FileSearchPage deals={deals} downloadFile={downloadFile} exportDocuments={exportDocuments} user={user} />}
        {currentPage === 'pr-filesearch' && <FileSearchPage deals={deals} downloadFile={downloadFile} exportDocuments={exportDocuments} user={user} />}
        {currentPage === 'pr-clients' && <PRClientsPage prClients={prClients} setPrClients={setPrClients} user={user} />}
        {currentPage === 'pr-dashboard' && <PRDashboardPage prClients={prClients} />}
        {currentPage === 'pr-alerts' && <PRContractAlertsPage prClients={prClients} />}
        {currentPage === 'users' && <UsersPage isAdmin={isAdmin} onUserRemoved={() => {}} />}
        {currentPage === 'usage' && <UsagePage isAdmin={isAdmin} />}
        {currentPage === 'settings' && <AccountSettingsPage user={user} onUpdate={() => {}} />}
      </main>

      <style>{`
        * {
          box-sizing: border-box;
        }

        :root {
          --primary: #2563eb;
          --success: #16a34a;
          --danger: #dc2626;
          --gray-50: #f9fafb;
          --gray-100: #f3f4f6;
          --gray-200: #e5e7eb;
          --gray-300: #d1d5db;
          --gray-600: #4b5563;
          --gray-900: #111827;
        }

        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
          background-color: #f5f6f7;
          color: var(--gray-900);
        }

        .app {
          display: flex;
          height: 100vh;
        }

        .navbar {
          width: 250px;
          background: white;
          border-right: 1px solid var(--gray-300);
          padding: 20px;
          display: flex;
          flex-direction: column;
          position: fixed;
          height: 100vh;
          left: 0;
          top: 0;
          overflow-y: auto;
        }

        .navbar-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 30px;
        }

        .logo-small {
          width: 40px;
          height: 40px;
          background: var(--primary);
          color: white;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 18px;
        }

        .brand-text {
          font-size: 16px;
          font-weight: 600;
        }

        .nav-menu {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
          margin-bottom: 30px;
        }

        .nav-item {
          padding: 12px 16px;
          background: none;
          border: none;
          border-left: 3px solid transparent;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 14px;
          color: var(--gray-600);
          transition: all 0.2s;
          border-radius: 4px;
        }

        .nav-item:hover {
          background: var(--gray-100);
          color: var(--gray-900);
        }

        .nav-item.active {
          background: var(--primary);
          color: white;
          border-left: 3px solid var(--primary);
        }

        .nav-item span {
          display: inline;
        }

        .navbar-user {
          display: flex;
          align-items: center;
          gap: 12px;
          padding-top: 16px;
          border-top: 1px solid var(--gray-300);
        }

        .user-info {
          flex: 1;
        }

        .user-name {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .user-email {
          margin: 4px 0 0 0;
          font-size: 12px;
          color: var(--gray-600);
        }

        .btn-logout {
          background: none;
          border: none;
          font-size: 18px;
          cursor: pointer;
          padding: 8px;
          border-radius: 4px;
          transition: all 0.2s;
        }

        .btn-logout:hover {
          background: var(--gray-100);
        }

        .main-content {
          margin-left: 250px;
          flex: 1;
          overflow: auto;
          padding: 30px;
        }

        .login-page {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: linear-gradient(135deg, var(--primary) 0%, #1d4ed8 100%);
        }

        .login-container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
          width: 100%;
          max-width: 400px;
        }

        .login-logo {
          text-align: center;
          margin-bottom: 20px;
        }

        .logo-circle {
          width: 60px;
          height: 60px;
          background: var(--primary);
          color: white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: bold;
          margin: 0 auto;
        }

        .login-container h1 {
          margin: 0 0 8px 0;
          text-align: center;
          font-size: 24px;
        }

        .login-subtitle {
          text-align: center;
          color: var(--gray-600);
          margin: 0 0 30px 0;
          font-size: 14px;
        }

        .loading {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          font-size: 18px;
          color: var(--primary);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 13px;
          font-weight: 600;
          color: var(--gray-900);
        }

        .form-group input,
        .form-group select,
        .form-group textarea {
          padding: 10px 12px;
          border: 1px solid var(--gray-300);
          border-radius: 6px;
          font-size: 14px;
          font-family: inherit;
        }

        .form-group input:focus,
        .form-group select:focus,
        .form-group textarea:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .form-grid {
          display: grid;
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))';
          gap: 16px;
        }

        .form-group.full-width {
          gridColumn: 1 / -1;
        }

        .btn {
          padding: 10px 16px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-primary {
          background: var(--primary);
          color: white;
        }

        .btn-primary:hover {
          background: #1d4ed8;
        }

        .btn-secondary {
          background: var(--gray-200);
          color: var(--gray-900);
        }

        .btn-secondary:hover {
          background: var(--gray-300);
        }

        .btn-danger {
          background: var(--danger);
          color: white;
        }

        .btn-danger:hover {
          background: #b91c1c;
        }

        .btn-large {
          padding: 12px 20px;
          font-size: 15px;
        }

        .btn-small {
          padding: 6px 12px;
          font-size: 12px;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 100;
        }

        .modal {
          background: white;
          border-radius: 12px;
          padding: 30px;
          max-width: 600px;
          width: 90%;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }

        .modal h2 {
          margin: 0 0 20px 0;
          font-size: 20px;
        }

        .modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid var(--gray-300);
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .page-header h1 {
          margin: 0;
        }

        .search-bar {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }

        .search-bar input {
          flex: 1;
          min-width: 200px;
        }

        .metrics-grid {
          display: grid;
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))';
          gap: 16px;
          margin-bottom: 30px;
        }

        .metric-card {
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: 8px;
          padding: 20px;
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }

        .metric-icon {
          width: 48px;
          height: 48px;
          background: var(--primary);
          color: white;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          font-weight: bold;
          flex-shrink: 0;
        }

        .metric-label {
          margin: 0;
          font-size: 12px;
          color: var(--gray-600);
          font-weight: 600;
        }

        .metric-value {
          margin: 4px 0 0 0;
          font-size: 24px;
          font-weight: bold;
          color: var(--gray-900);
        }

        .table-container {
          background: white;
          border: 1px solid var(--gray-300);
          border-radius: 8px;
          overflow: hidden;
        }

        .table {
          width: 100%;
          border-collapse: collapse;
        }

        .table thead tr {
          background: var(--gray-50);
          border-bottom: 1px solid var(--gray-300);
        }

        .table th {
          padding: 16px;
          text-align: left;
          font-size: 13px;
          font-weight: 600;
          color: var(--gray-600);
        }

        .table td {
          padding: 16px;
          border-bottom: 1px solid var(--gray-300);
          font-size: 14px;
        }

        .table tbody tr:hover {
          background: var(--gray-50);
        }

        .empty-state {
          text-align: center;
          padding: 40px;
          color: var(--gray-600);
          font-size: 14px;
        }

        @media (max-width: 768px) {
          .navbar {
            width: 200px;
          }

          .main-content {
            margin-left: 200px;
            padding: 16px;
          }

          .metrics-grid {
            gridTemplateColumns: 1fr;
          }

          .nav-item span {
            display: none;
          }

          .form-grid {
            gridTemplateColumns: 1fr;
          }
        }

        @media (max-width: 640px) {
          .navbar {
            width: 100%;
            height: auto;
            position: static;
            border-right: none;
            border-bottom: 1px solid var(--gray-300);
            flex-direction: row;
            padding: 12px;
          }

          .main-content {
            margin-left: 0;
          }

          .navbar-brand {
            margin-bottom: 0;
          }

          .nav-menu {
            display: none;
            flex-direction: column;
            gap: 0;
            flex: none;
            margin-bottom: 0;
          }

          .navbar.open .nav-menu {
            display: flex;
          }

          .navbar-user {
            display: none;
          }

          .page-header {
            flex-direction: column;
            gap: 12px;
            align-items: flex-start;
          }

          .page-header .btn {
            width: 100%;
          }
        }

        .service-toggle-btn {
          background-color: var(--gray-100) !important;
        }

        .service-toggle-btn:hover {
          background-color: var(--gray-200) !important;
        }
      `}</style>
    </div>
  )
}

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    try {
      let userCredential
      if (isSignup) {
        if (!email.includes('@talentresources.com')) {
          setError('Only @talentresources.com email addresses are allowed to sign up')
          return
        }
        userCredential = await createUserWithEmailAndPassword(auth, email, password)
        await addDoc(collection(db, 'users'), {
          email: email,
          uid: userCredential.user.uid,
          createdAt: new Date(),
          status: 'active',
          name: fullName
        })
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password)
      }
      onLogin(userCredential.user)
    } catch (error) {
      setError(error.message)
    }
  }

  const handleForgotPassword = async (e) => {
    e.preventDefault()
    setError('')
    setSuccessMessage('')
    try {
      await sendPasswordResetEmail_helper(email)
      setSuccessMessage('Password reset email sent! Check your inbox.')
      setEmail('')
    } catch (error) {
      setError(error.message)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-logo">
          <div className="logo-circle">TR</div>
        </div>
        <h1>Talent Resources CRM</h1>
        <p className="login-subtitle">Deal Management Platform</p>

        {isForgotPassword ? (
          <form onSubmit={handleForgotPassword}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>
            {error && <p style={{ color: '#EF4444', fontSize: '14px' }}>{error}</p>}
            {successMessage && <p style={{ color: '#16a34a', fontSize: '14px' }}>{successMessage}</p>}
            <button type="submit" className="btn btn-primary btn-large" style={{ width: '100%', marginTop: '20px' }}>
              Send Reset Email
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            {isSignup && (
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  required={isSignup}
                />
              </div>
            )}
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </div>
            {error && <p style={{ color: '#EF4444', fontSize: '14px' }}>{error}</p>}
            <button type="submit" className="btn btn-primary btn-large" style={{ width: '100%', marginTop: '20px' }}>
              {isSignup ? 'Create Account' : 'Sign In'}
            </button>
          </form>
        )}

        {!isForgotPassword && (
          <p style={{ textAlign: 'center', marginTop: '12px', fontSize: '12px' }}>
            <button
              onClick={() => setIsForgotPassword(true)}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Forgot password?
            </button>
          </p>
        )}

        <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '14px' }}>
          {isForgotPassword ? (
            <>
              Remember your password?
              {' '}
              <button
                onClick={() => { setIsForgotPassword(false); setError(''); setSuccessMessage('') }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Sign In
              </button>
            </>
          ) : (
            <>
              {isSignup ? 'Already have an account?' : "Don't have an account?"}
              {' '}
              <button
                onClick={() => { setIsSignup(!isSignup); setError(''); setFullName('') }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
              >
                {isSignup ? 'Sign In' : 'Sign Up'}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function Dashboard({ deals, contacts, isAdmin }) {
  const [dateFilter, setDateFilter] = useState('all')
  const [viewType, setViewType] = useState('company')
  const [expandedOwners, setExpandedOwners] = useState(new Set())

  const filteredDeals = deals.filter(deal => {
    if (dateFilter === 'all') return true
    const qy = getQuarterYear(deal.dealDate)
    return qy === dateFilter
  })

  const getQuarters = () => {
    const quarters = new Set()
    deals.forEach(deal => quarters.add(getQuarterYear(deal.dealDate)))
    return Array.from(quarters).sort().reverse()
  }

  const ownerMetrics = {}
  filteredDeals.forEach(deal => {
    const owner = deal.dealOwnerName || 'Unassigned'
    if (!ownerMetrics[owner]) {
      ownerMetrics[owner] = { deals: 0, revenue: 0, profit: 0 }
    }
    ownerMetrics[owner].deals += 1
    if (isAdmin) {
      ownerMetrics[owner].revenue += (deal.feeCharged || 0)
      ownerMetrics[owner].profit += ((deal.feeCharged || 0) - (deal.feePaid || 0))
    }
  })

  const sortedOwners = Object.entries(ownerMetrics).sort((a, b) => b[1].deals - a[1].deals)

  const totalRevenue = filteredDeals.reduce((sum, d) => sum + (d.feeCharged || 0), 0)
  const totalProfit = filteredDeals.reduce((sum, d) => sum + ((d.feeCharged || 0) - (d.feePaid || 0)), 0)
  const closedWon = filteredDeals.filter(d => d.status === 'Closed Won').length

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Dashboard</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px' }}>
            <option value="all">All Time</option>
            {getQuarters().map(q => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <select value={viewType} onChange={(e) => setViewType(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px' }}>
            <option value="company">Company View</option>
            <option value="individual">Individual View</option>
          </select>
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon">D</div>
          <div>
            <p className="metric-label">Total Deals</p>
            <p className="metric-value">{filteredDeals.length}</p>
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-icon">✓</div>
          <div>
            <p className="metric-label">Closed Won</p>
            <p className="metric-value">{closedWon}</p>
          </div>
        </div>
        {isAdmin && (
          <>
            <div className="metric-card">
              <div className="metric-icon">$</div>
              <div>
                <p className="metric-label">Total Revenue</p>
                <p className="metric-value">${formatCurrency(totalRevenue)}</p>
              </div>
            </div>
            <div className="metric-card">
              <div className="metric-icon">P</div>
              <div>
                <p className="metric-label">Total Profit</p>
                <p className="metric-value">${formatCurrency(totalProfit)}</p>
              </div>
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: '40px' }}>
        <h2 style={{ marginBottom: '20px' }}>Performance by Team Member</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th></th>
                <th>Team Member</th>
                <th>Deals</th>
                {isAdmin && (
                  <>
                    <th>Revenue</th>
                    <th>Profit</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedOwners.length === 0 ? (
                <tr><td colSpan={isAdmin ? 5 : 3} style={{ textAlign: 'center' }}>No deals yet</td></tr>
              ) : (
                sortedOwners.map(([owner, metrics]) => {
                  const isExpanded = expandedOwners.has(owner)
                  const ownerDeals = filteredDeals.filter(d => (d.dealOwnerName || 'Unassigned') === owner)
                  return (
                    <React.Fragment key={owner}>
                      <tr onClick={() => {
                        const newExpanded = new Set(expandedOwners)
                        if (newExpanded.has(owner)) {
                          newExpanded.delete(owner)
                        } else {
                          newExpanded.add(owner)
                        }
                        setExpandedOwners(newExpanded)
                      }} style={{ cursor: 'pointer' }}>
                        <td style={{ textAlign: 'center', width: '40px' }}>{isExpanded ? '▼' : '▶'}</td>
                        <td><strong>{owner}</strong></td>
                        <td>{metrics.deals}</td>
                        {isAdmin && (
                          <>
                            <td>${formatCurrency(metrics.revenue)}</td>
                            <td style={{ color: 'var(--success)', fontWeight: 'bold' }}>${formatCurrency(metrics.profit)}</td>
                          </>
                        )}
                      </tr>
                      {isExpanded && ownerDeals.map(deal => (
                        <tr key={deal.id} style={{ backgroundColor: 'var(--gray-50)' }}>
                          <td></td>
                          <td colSpan={isAdmin ? 4 : 2}>
                            <div style={{ paddingLeft: '20px', fontSize: '14px' }}>
                              <div><strong>{deal.brand}</strong> - {deal.talent}</div>
                              <div style={{ color: 'var(--gray-600)', fontSize: '12px', marginTop: '4px' }}>
                                {deal.status} | {new Date(deal.dealDate).toLocaleDateString()}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function DealsPage({ deals, contacts, user, isAdmin, onReload, onContactAdded, downloadFile }) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [search, setSearch] = useState('')
  const [filterOwner, setFilterOwner] = useState('all')
  const [selected, setSelected] = useState(new Set())
  const [contactSearch, setContactSearch] = useState('')
  const [showContactSuggestions, setShowContactSuggestions] = useState(false)
  const [repTalentSearch, setRepTalentSearch] = useState('')
  const [showRepTalentSuggestions, setShowRepTalentSuggestions] = useState(false)
  const [brandSearch, setBrandSearch] = useState('')
  const [showBrandSuggestions, setShowBrandSuggestions] = useState(false)
  const [brandRepSearch, setBrandRepSearch] = useState('')
  const [showBrandRepSuggestions, setShowBrandRepSuggestions] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactModalContext, setContactModalContext] = useState('brand') // 'brand', 'talent', 'brandRep'
  const [newContactData, setNewContactData] = useState({ name: '', email: '', phone: '', company: '', title: '', type: '', notes: '' })
  const [expandedDeals, setExpandedDeals] = useState(new Set())
  const [expandedServices, setExpandedServices] = useState({})
  const [profileView, setProfileView] = useState(null) // 'talent', 'brand', 'agency', or null
  const [selectedTalent, setSelectedTalent] = useState(null)
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [selectedAgency, setSelectedAgency] = useState(null)
  const [dealFileSearch, setDealFileSearch] = useState('')
  const [dealOwnerSearch, setDealOwnerSearch] = useState('')
  const [showDealOwnerSuggestions, setShowDealOwnerSuggestions] = useState(false)
  const [teamUsers, setTeamUsers] = useState([])

  // Load team users from Firestore on mount
  useEffect(() => {
    const loadTeamUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'))
        const users = snapshot.docs.map(d => ({
          email: d.data().email,
          name: d.data().name || d.data().email.split('@')[0]
        }))
        setTeamUsers(users)
      } catch (error) {
        console.error('Error loading team users:', error)
      }
    }
    if (user) loadTeamUsers()
  }, [user])

  const currentUser = teamUsers.find(m => m.email === user.email)
  const currentUserName = currentUser?.name || user.email

  const [formData, setFormData] = useState({
    brand: '',
    brandId: '',
    talent: '',
    dealDate: new Date().toISOString().split('T')[0],
    dealOwnerEmail: user.email,
    dealOwnerName: currentUserName,
    status: 'Qualified Lead',
    feePaid: 0,
    feeCharged: 0,
    prCost: 0,
    glamCost: 0,
    glamBuyout: false,
    stylingCost: 0,
    stylingBuyout: false,
    travelCost: 0,
    travelBuyout: false,
    talentFee: 0,
    brokerFee: 0,
    sagFee: false,
    sagFeeCost: 0,
    otherCosts: 0,
    contactId: '',
    brandReps: [],
    brandRepIds: [],
    repForTalent: [],
    repForTalentIds: [],
    services: [],
    serviceDetails: {
      Performance: '',
      Appearance: '',
      'Social Media Program': ''
    },
    appearanceLocation: '',
    usageRights: '',
    notes: '',
    brandReachedOutDate: '',
    suggestionsSharedDate: '',
    offerMadeDate: '',
    contractSignedDate: '',
    servicesCompletedDate: '',
    paymentDate: '',
    agency: '',
    fileAttachments: []
  })
  const fileInputRef = React.useRef(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const filesWithUploadedBy = (formData.fileAttachments || []).map(file => ({
        ...file,
        uploadedBy: user.email
      }))

      const dataToSave = {
        ...formData,
        fileAttachments: filesWithUploadedBy,
        feePaid: isAdmin ? parseFloat(formData.feePaid) : 0,
        feeCharged: isAdmin ? parseFloat(formData.feeCharged) : 0,
        prCost: parseFloat(formData.prCost),
        glamCost: parseFloat(formData.glamCost),
        stylingCost: parseFloat(formData.stylingCost),
        travelCost: parseFloat(formData.travelCost),
        talentFee: parseFloat(formData.talentFee),
        brokerFee: parseFloat(formData.brokerFee),
        sagFeeCost: parseFloat(formData.sagFeeCost) || 0,
        otherCosts: parseFloat(formData.otherCosts),
        lastEditedBy: currentUserName,
        lastEditedAt: new Date()
      }

      if (editingId) {
        await updateDoc(doc(db, 'deals', editingId), dataToSave)
        // Log activity
        await addDoc(collection(db, 'activity'), {
          type: 'deal_updated',
          user: currentUserName,
          userEmail: user.email,
          dealId: editingId,
          dealBrand: formData.brand,
          dealTalent: formData.talent,
          timestamp: new Date()
        })
      } else {
        await addDoc(collection(db, 'deals'), {
          ...dataToSave,
          createdBy: currentUserName,
          createdAt: new Date(),
          dealNotes: []
        })
        // Log activity
        await addDoc(collection(db, 'activity'), {
          type: 'deal_created',
          user: currentUserName,
          userEmail: user.email,
          dealBrand: formData.brand,
          dealTalent: formData.talent,
          timestamp: new Date()
        })
      }
      onReload()
      resetForm()
    } catch (error) {
      alert('Error saving deal: ' + error.message)
    }
  }

  const handleFileUpload = (e) => {
    const files = e.target.files
    if (!files) return

    const newFiles = Array.from(files).map(file => ({
      name: file.name,
      size: file.size,
      type: file.type,
      addedAt: new Date(),
      dataUrl: null
    }))

    // Read files as data URLs for storage
    let processedCount = 0
    newFiles.forEach((fileInfo, idx) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        newFiles[idx].dataUrl = event.target.result
        processedCount++
        if (processedCount === newFiles.length) {
          setFormData({
            ...formData,
            fileAttachments: [...(formData.fileAttachments || []), ...newFiles]
          })
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
        }
      }
      reader.readAsDataURL(files[idx])
    })
  }

  const removeFile = (index) => {
    const newFiles = formData.fileAttachments.filter((_, i) => i !== index)
    setFormData({...formData, fileAttachments: newFiles})
  }

  const resetForm = () => {
    setFormData({
      brand: '',
      brandId: '',
      talent: '',
      dealDate: new Date().toISOString().split('T')[0],
      dealOwnerEmail: user.email,
      dealOwnerName: currentUserName,
      status: 'Qualified Lead',
      feePaid: 0,
      feeCharged: 0,
      prCost: 0,
      glamCost: 0,
      glamBuyout: false,
      stylingCost: 0,
      stylingBuyout: false,
      travelCost: 0,
      travelBuyout: false,
      talentFee: 0,
      brokerFee: 0,
      sagFee: false,
      sagFeeCost: 0,
      otherCosts: 0,
      contactId: '',
      brandReps: [],
      brandRepIds: [],
      repForTalent: [],
      repForTalentIds: [],
      services: [],
      serviceDetails: {
        Performance: '',
        Appearance: '',
        'Social Media Program': ''
      },
      appearanceLocation: '',
      usageRights: '',
      notes: '',
      brandReachedOutDate: '',
      suggestionsSharedDate: '',
      offerMadeDate: '',
      contractSignedDate: '',
      servicesCompletedDate: '',
      paymentDate: '',
      agency: '',
      fileAttachments: []
    })
    setExpandedServices({})
    setContactSearch('')
    setRepTalentSearch('')
    setBrandRepSearch('')
    setDealOwnerSearch('')
    setEditingId(null)
    setShowForm(false)
  }

  const handleDelete = async (id) => {
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm('Delete this deal?')) {
      try {
        const dealDoc = deals.find(d => d.id === id)
        await deleteDoc(doc(db, 'deals', id))
        // Log activity
        if (dealDoc) {
          await addDoc(collection(db, 'activity'), {
            type: 'deal_deleted',
            user: currentUserName,
            userEmail: user.email,
            dealId: id,
            dealBrand: dealDoc.brand,
            dealTalent: dealDoc.talent,
            timestamp: new Date()
          })
        }
        onReload()
      } catch (error) {
        alert('Error deleting deal')
      }
    }
  }

  const handleBulkDelete = async () => {
    if (selected.size === 0) {
      alert('No deals selected')
      return
    }
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm(`Delete ${selected.size} deal(s)?`)) {
      try {
        for (const dealId of selected) {
          await deleteDoc(doc(db, 'deals', dealId))
        }
        setSelected(new Set())
        onReload()
      } catch (error) {
        alert('Error deleting deals: ' + error.message)
      }
    }
  }

  const toggleSelect = (dealId) => {
    const newSelected = new Set(selected)
    if (newSelected.has(dealId)) {
      newSelected.delete(dealId)
    } else {
      newSelected.add(dealId)
    }
    setSelected(newSelected)
  }

  const handleAddContact = async (e) => {
    e.preventDefault()
    try {
      const newContact = await addDoc(collection(db, 'contacts'), {
        ...newContactData,
        userId: user.uid,
        createdAt: new Date()
      })
      if (contactModalContext === 'brand') {
        setFormData({...formData, contactId: newContact.id})
        setContactSearch(newContactData.name)
      } else {
        setFormData({...formData, repForTalentId: newContact.id, repForTalent: newContactData.name})
        setRepTalentSearch(newContactData.name)
      }
      setNewContactData({ name: '', email: '', phone: '', company: '', title: '', type: '', notes: '' })
      setShowContactModal(false)
      onContactAdded()
    } catch (error) {
      alert('Error adding contact: ' + error.message)
    }
  }

  const openEdit = (deal) => {
    setFormData({
      ...deal,
      dealDate: deal.dealDate || new Date().toISOString().split('T')[0],
      talentFee: deal.talentFee || 0,
      brokerFee: deal.brokerFee || 0,
      sagFeeCost: deal.sagFeeCost || 0,
      brandId: deal.brandId || '',
      glamBuyout: deal.glamBuyout || false,
      stylingBuyout: deal.stylingBuyout || false,
      travelBuyout: deal.travelBuyout || false,
      sagFee: deal.sagFee || false,
      brandReps: deal.brandReps || [],
      brandRepIds: deal.brandRepIds || [],
      repForTalent: deal.repForTalent || '',
      repForTalentIds: deal.repForTalentIds || [],
      services: Array.isArray(deal.services) ? deal.services : [],
      serviceDetails: deal.serviceDetails || {
        Performance: '',
        Appearance: '',
        'Social Media Program': ''
      },
      appearanceLocation: deal.appearanceLocation || '',
      brandReachedOutDate: deal.brandReachedOutDate || '',
      suggestionsSharedDate: deal.suggestionsSharedDate || '',
      offerMadeDate: deal.offerMadeDate || '',
      contractSignedDate: deal.contractSignedDate || '',
      servicesCompletedDate: deal.servicesCompletedDate || '',
      paymentDate: deal.paymentDate || '',
      agency: deal.agency || '',
      fileAttachments: deal.fileAttachments || []
    })
    const contactName = deal.contactId ? contacts.find(c => c.id === deal.contactId)?.name || '' : ''
    setContactSearch(contactName)
    const repTalentName = deal.repForTalentId ? contacts.find(c => c.id === deal.repForTalentId)?.name || deal.repForTalent || '' : deal.repForTalent || ''
    setRepTalentSearch(repTalentName)
    const dealOwnerName = deal.dealOwnerName || teamUsers.find(u => u.email === deal.dealOwnerEmail)?.name || deal.dealOwnerEmail
    setDealOwnerSearch(dealOwnerName)
    if (Array.isArray(deal.services) && deal.services.length > 0) {
      const expanded = {}
      deal.services.forEach(s => {
        expanded[s] = false
      })
      setExpandedServices(expanded)
    } else {
      setExpandedServices({})
    }
    setEditingId(deal.id)
    setShowForm(true)
  }

  const filteredDeals = deals.filter(d => {
    const ownerMatch = filterOwner === 'all' || (d.dealOwnerName || 'Unassigned') === filterOwner
    const searchMatch = !search ||
      d.brand.toLowerCase().includes(search.toLowerCase()) ||
      d.talent.toLowerCase().includes(search.toLowerCase())
    return ownerMatch && searchMatch
  })

  const getUniqueOwners = () => {
    const owners = new Set(deals.map(d => d.dealOwnerName || 'Unassigned'))
    return Array.from(owners).sort()
  }

  const netProfit = (deal) => {
    return (deal.feeCharged || 0) - (deal.feePaid || 0)
  }

  const getContactName = (contactId) => {
    if (!contactId) return 'None'
    const contact = contacts.find(c => c.id === contactId)
    return contact ? contact.name : 'Unknown'
  }

  const groupedDeals = {}
  filteredDeals.forEach(deal => {
    const owner = deal.dealOwnerName || 'Unassigned'
    if (!groupedDeals[owner]) {
      groupedDeals[owner] = []
    }
    groupedDeals[owner].push(deal)
  })

  const toggleDealExpand = (dealId) => {
    const newExpanded = new Set(expandedDeals)
    if (newExpanded.has(dealId)) {
      newExpanded.delete(dealId)
    } else {
      newExpanded.add(dealId)
    }
    setExpandedDeals(newExpanded)
  }

  // Profile view mode
  if (profileView === 'talent' && selectedTalent) {
    return (
      <TalentProfileView
        talentName={selectedTalent}
        deals={deals}
        contacts={contacts}
        onBack={() => { setProfileView(null); setSelectedTalent(null) }}
        isAdmin={isAdmin}
        getContactName={getContactName}
        netProfit={netProfit}
      />
    )
  }

  if (profileView === 'brand' && selectedBrand) {
    return (
      <BrandProfileView
        brandName={selectedBrand}
        deals={deals}
        contacts={contacts}
        onBack={() => { setProfileView(null); setSelectedBrand(null) }}
        isAdmin={isAdmin}
        getContactName={getContactName}
        netProfit={netProfit}
      />
    )
  }

  if (profileView === 'agency' && selectedAgency) {
    return (
      <AgencyProfileView
        agencyName={selectedAgency}
        deals={deals}
        contacts={contacts}
        onBack={() => { setProfileView(null); setSelectedAgency(null) }}
        isAdmin={isAdmin}
        getContactName={getContactName}
        netProfit={netProfit}
      />
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1>Deals</h1>
        <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true) }}>
          New Deal
        </button>
      </div>

      <div className="search-bar" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search by brand, talent..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '200px', padding: '10px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }}
        />
        <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', fontSize: '14px' }}>
          <option value="all">All Owners</option>
          {getUniqueOwners().map(owner => (
            <option key={owner} value={owner}>{owner}</option>
          ))}
        </select>
        {selected.size > 0 && (
          <button className="btn btn-danger" onClick={handleBulkDelete}>
            Delete {selected.size}
          </button>
        )}
      </div>

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto', maxWidth: '90vw', width: '100%' }}>
            <h2>{editingId ? 'Edit Deal' : 'New Deal'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', '@media (max-width: 768px)': { gridTemplateColumns: '1fr' } }}>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Deal Owner</label>
                  <input
                    type="text"
                    placeholder="Type to search team members..."
                    value={dealOwnerSearch}
                    onChange={(e) => {
                      setDealOwnerSearch(e.target.value)
                      setShowDealOwnerSuggestions(true)
                    }}
                    onFocus={() => setShowDealOwnerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowDealOwnerSuggestions(false), 200)}
                    required
                  />
                  {showDealOwnerSuggestions && dealOwnerSearch && (
                    <div style={{ position: 'absolute', top: '100%', left: '0', right: '0', backgroundColor: 'white', border: '1px solid var(--gray-300)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto', zIndex: '10' }}>
                      {teamUsers.filter(u => u.name.toLowerCase().includes(dealOwnerSearch.toLowerCase()) || u.email.toLowerCase().includes(dealOwnerSearch.toLowerCase())).map(user => (
                        <div
                          key={user.email}
                          onClick={() => {
                            setFormData({ ...formData, dealOwnerEmail: user.email, dealOwnerName: user.name })
                            setDealOwnerSearch(user.name)
                            setShowDealOwnerSuggestions(false)
                          }}
                          style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--gray-100)'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {user.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})} required>
                    {DEAL_STATUSES.map(status => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Brand <span style={{ fontSize: '12px', color: 'var(--gray-500)', fontWeight: 'normal' }}>(type to search or add new)</span></label>
                  <input
                    type="text"
                    placeholder="Search or type brand name..."
                    value={formData.brand}
                    onChange={(e) => {
                      setFormData({...formData, brand: e.target.value})
                      setBrandSearch(e.target.value)
                      setShowBrandSuggestions(true)
                    }}
                    onFocus={() => setShowBrandSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowBrandSuggestions(false), 200)}
                    required
                  />
                  {showBrandSuggestions && brandSearch && (
                    <div style={{ position: 'absolute', top: '100%', left: '0', right: '0', backgroundColor: 'white', border: '1px solid var(--gray-300)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto', zIndex: '10' }}>
                      {Array.from(new Set(deals.map(d => d.brand).filter(b => b && b.toLowerCase().includes(brandSearch.toLowerCase())))).slice(0, 10).map(brand => (
                        <div
                          key={brand}
                          onClick={() => {
                            setFormData({...formData, brand})
                            setBrandSearch(brand)
                            setShowBrandSuggestions(false)
                          }}
                          style={{ padding: '10px', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--gray-100)'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {brand}
                        </div>
                      ))}
                      {brandSearch && !Array.from(new Set(deals.map(d => d.brand).filter(b => b && b.toLowerCase().includes(brandSearch.toLowerCase())))).length && (
                        <div style={{ padding: '12px', color: 'var(--primary)', fontSize: '14px', textAlign: 'center', fontWeight: '500', backgroundColor: 'var(--gray-50)', borderTop: '1px solid var(--gray-200)' }}>
                          + Create new brand: "{brandSearch}"
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label>Deal Date</label>
                  <input type="date" value={formData.dealDate} onChange={(e) => setFormData({...formData, dealDate: e.target.value})} required />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Talent</label>
                  <input type="text" value={formData.talent} onChange={(e) => setFormData({...formData, talent: e.target.value})} required />
                </div>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Brand Rep(s)</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {formData.brandReps && formData.brandReps.map((rep, idx) => (
                      <span key={idx} style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {rep}
                        <button
                          type="button"
                          onClick={() => {
                            const newReps = formData.brandReps.filter((_, i) => i !== idx)
                            const newIds = formData.brandRepIds.filter((_, i) => i !== idx)
                            setFormData({...formData, brandReps: newReps, brandRepIds: newIds})
                          }}
                          style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '0', fontSize: '14px' }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Search or add brand rep..."
                      value={brandRepSearch}
                      onChange={(e) => {
                        setBrandRepSearch(e.target.value)
                        setShowBrandRepSuggestions(true)
                      }}
                      onFocus={() => setShowBrandRepSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowBrandRepSuggestions(false), 200)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setContactModalContext('brandRep')
                        setShowContactModal(true)
                      }}
                      style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
                    >
                      New Contact
                    </button>
                  </div>
                  {showBrandRepSuggestions && brandRepSearch && (
                    <div style={{ position: 'absolute', top: '100%', left: '0', right: '0', backgroundColor: 'white', border: '1px solid var(--gray-300)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto', zIndex: '10', marginTop: '2px' }}>
                      {contacts.filter(c => c.name.toLowerCase().includes(brandRepSearch.toLowerCase()) && !formData.brandReps.includes(c.name)).map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFormData({...formData, brandReps: [...formData.brandReps, c.name], brandRepIds: [...formData.brandRepIds, c.id]})
                            setBrandRepSearch('')
                            setShowBrandRepSuggestions(false)
                          }}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--gray-100)'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {c.name}
                        </div>
                      ))}
                      {contacts.filter(c => c.name.toLowerCase().includes(brandRepSearch.toLowerCase())).length === 0 && (
                        <div
                          onClick={async () => {
                            try {
                              const newContact = await addDoc(collection(db, 'contacts'), {
                                name: brandRepSearch,
                                email: '',
                                type: '',
                                title: '',
                                company: '',
                                phone: '',
                                notes: '',
                                userId: user.uid,
                                createdAt: new Date()
                              })
                              setFormData({...formData, brandReps: [...formData.brandReps, brandRepSearch], brandRepIds: [...formData.brandRepIds, newContact.id]})
                              setBrandRepSearch('')
                              setShowBrandRepSuggestions(false)
                              onContactAdded()
                            } catch (err) {
                              alert('Error adding contact: ' + err.message)
                            }
                          }}
                          style={{ padding: '8px 12px', color: 'var(--primary)', fontSize: '14px', cursor: 'pointer', textAlign: 'center', fontWeight: '500', borderTop: '1px solid var(--gray-200)', backgroundColor: 'var(--gray-50)' }}
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'var(--primary)'
                            e.target.style.color = 'white'
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'var(--gray-50)'
                            e.target.style.color = 'var(--primary)'
                          }}
                        >
                          + Add "{brandRepSearch}" as new contact
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Rep for Talent</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {formData.repForTalent && formData.repForTalent.map((rep, idx) => (
                      <span key={idx} style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {rep}
                        <button
                          type="button"
                          onClick={() => {
                            const newReps = formData.repForTalent.filter((_, i) => i !== idx)
                            const newIds = formData.repForTalentIds.filter((_, i) => i !== idx)
                            setFormData({...formData, repForTalent: newReps, repForTalentIds: newIds})
                          }}
                          style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '0', fontSize: '14px' }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Search or add talent rep..."
                      value={repTalentSearch}
                      onChange={(e) => {
                        setRepTalentSearch(e.target.value)
                        setShowRepTalentSuggestions(true)
                      }}
                      onFocus={() => setShowRepTalentSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowRepTalentSuggestions(false), 200)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setContactModalContext('talent')
                        setShowContactModal(true)
                      }}
                      style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
                    >
                      New Contact
                    </button>
                  </div>
                  {showRepTalentSuggestions && repTalentSearch && (
                    <div style={{ position: 'absolute', top: '100%', left: '0', right: '0', backgroundColor: 'white', border: '1px solid var(--gray-300)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto', zIndex: '10', marginTop: '2px' }}>
                      {contacts.filter(c => c.name.toLowerCase().includes(repTalentSearch.toLowerCase()) && !formData.repForTalent.includes(c.name)).map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFormData({...formData, repForTalent: [...formData.repForTalent, c.name], repForTalentIds: [...formData.repForTalentIds, c.id]})
                            setRepTalentSearch('')
                            setShowRepTalentSuggestions(false)
                          }}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--gray-100)'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {c.name}
                        </div>
                      ))}
                      {contacts.filter(c => c.name.toLowerCase().includes(repTalentSearch.toLowerCase())).length === 0 && (
                        <div
                          onClick={async () => {
                            try {
                              const newContact = await addDoc(collection(db, 'contacts'), {
                                name: repTalentSearch,
                                email: '',
                                type: '',
                                title: '',
                                company: '',
                                phone: '',
                                notes: '',
                                userId: user.uid,
                                createdAt: new Date()
                              })
                              setFormData({...formData, repForTalent: [...formData.repForTalent, repTalentSearch], repForTalentIds: [...formData.repForTalentIds, newContact.id]})
                              setRepTalentSearch('')
                              setShowRepTalentSuggestions(false)
                              onContactAdded()
                            } catch (err) {
                              alert('Error adding contact: ' + err.message)
                            }
                          }}
                          style={{ padding: '8px 12px', color: 'var(--primary)', fontSize: '14px', cursor: 'pointer', textAlign: 'center', fontWeight: '500', borderTop: '1px solid var(--gray-200)', backgroundColor: 'var(--gray-50)' }}
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'var(--primary)'
                            e.target.style.color = 'white'
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'var(--gray-50)'
                            e.target.style.color = 'var(--primary)'
                          }}
                        >
                          + Add "{repTalentSearch}" as new contact
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>Brand Contact</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Search contacts..."
                      value={contactSearch}
                      onChange={(e) => {
                        setContactSearch(e.target.value)
                        setShowContactSuggestions(true)
                      }}
                      onFocus={() => setShowContactSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowContactSuggestions(false), 200)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setContactModalContext('brand')
                        setShowContactModal(true)
                      }}
                      style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}
                    >
                      New Contact
                    </button>
                  </div>
                  {showContactSuggestions && contactSearch && (
                    <div style={{ position: 'absolute', top: '100%', left: '0', right: '0', backgroundColor: 'white', border: '1px solid var(--gray-300)', borderTop: 'none', borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto', zIndex: '10' }}>
                      {contacts.filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase())).map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setFormData({...formData, contactId: c.id})
                            setContactSearch(c.name)
                            setShowContactSuggestions(false)
                          }}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--gray-200)' }}
                          onMouseEnter={(e) => e.target.style.backgroundColor = 'var(--gray-100)'}
                          onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                        >
                          {c.name}
                        </div>
                      ))}
                      {contacts.filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase())).length === 0 && (
                        <div
                          onClick={async () => {
                            try {
                              const newContact = await addDoc(collection(db, 'contacts'), {
                                name: contactSearch,
                                email: '',
                                type: '',
                                title: '',
                                company: '',
                                phone: '',
                                notes: '',
                                userId: user.uid,
                                createdAt: new Date()
                              })
                              setFormData({...formData, contactId: newContact.id})
                              setContactSearch(contactSearch)
                              setShowContactSuggestions(false)
                              onContactAdded()
                            } catch (err) {
                              alert('Error adding contact: ' + err.message)
                            }
                          }}
                          style={{ padding: '8px 12px', color: 'var(--primary)', fontSize: '14px', cursor: 'pointer', textAlign: 'center', fontWeight: '500', borderTop: '1px solid var(--gray-200)', backgroundColor: 'var(--gray-50)' }}
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = 'var(--primary)'
                            e.target.style.color = 'white'
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'var(--gray-50)'
                            e.target.style.color = 'var(--primary)'
                          }}
                        >
                          + Add "{contactSearch}" as new contact
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <div className="form-group" style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div>
                      <label>Fee Paid to Talent ($)</label>
                      <input type="number" value={formData.feePaid} onChange={(e) => setFormData({...formData, feePaid: e.target.value})} style={{ width: '100%' }} />
                    </div>
                    <div>
                      <label>Fee Charged to Client ($)</label>
                      <input type="number" value={formData.feeCharged} onChange={(e) => setFormData({...formData, feeCharged: e.target.value})} style={{ width: '100%' }} />
                    </div>
                  </div>
                )}

                <div style={{ gridColumn: '1 / -1', borderTop: '2px solid var(--gray-300)', paddingTop: '20px', marginTop: '24px' }}>
                  <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>Cost Breakdown</h3>
                  <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                    <div className="form-group">
                      <label>PR Cost ($)</label>
                      <input type="number" value={formData.prCost} onChange={(e) => setFormData({...formData, prCost: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Glam Cost ($)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="number" value={formData.glamCost} onChange={(e) => setFormData({...formData, glamCost: e.target.value})} style={{ flex: 1 }} />
                        <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                          <input type="checkbox" checked={formData.glamBuyout} onChange={(e) => setFormData({...formData, glamBuyout: e.target.checked})} /> Buyout
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Styling Cost ($)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="number" value={formData.stylingCost} onChange={(e) => setFormData({...formData, stylingCost: e.target.value})} style={{ flex: 1 }} />
                        <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                          <input type="checkbox" checked={formData.stylingBuyout} onChange={(e) => setFormData({...formData, stylingBuyout: e.target.checked})} /> Buyout
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Travel Cost ($)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="number" value={formData.travelCost} onChange={(e) => setFormData({...formData, travelCost: e.target.value})} style={{ flex: 1 }} />
                        <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                          <input type="checkbox" checked={formData.travelBuyout} onChange={(e) => setFormData({...formData, travelBuyout: e.target.checked})} /> Buyout
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Talent Fee ($)</label>
                      <input type="number" value={formData.talentFee} onChange={(e) => setFormData({...formData, talentFee: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Broker Fee ($)</label>
                      <input type="number" value={formData.brokerFee} onChange={(e) => setFormData({...formData, brokerFee: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>SAG Fee ($)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input type="number" value={formData.sagFeeCost} onChange={(e) => setFormData({...formData, sagFeeCost: e.target.value})} placeholder="0" style={{ flex: 1 }} />
                        <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>
                          <input type="checkbox" checked={formData.sagFee} onChange={(e) => setFormData({...formData, sagFee: e.target.checked})} /> Applies
                        </label>
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Other Costs ($)</label>
                      <input type="number" value={formData.otherCosts} onChange={(e) => setFormData({...formData, otherCosts: e.target.value})} />
                    </div>
                  </div>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Services</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '8px', marginBottom: '16px' }}>
                    {['Performance', 'Appearance', 'Social Media Program'].map(service => (
                      <label key={service} style={{ display: 'flex', alignItems: 'center', marginBottom: 0 }}>
                        <input
                          type="checkbox"
                          checked={formData.services.includes(service)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({...formData, services: [...formData.services, service]})
                              setExpandedServices({...expandedServices, [service]: true})
                            } else {
                              setFormData({...formData, services: formData.services.filter(s => s !== service)})
                              const newExpanded = {...expandedServices}
                              delete newExpanded[service]
                              setExpandedServices(newExpanded)
                            }
                          }}
                          style={{ marginRight: '6px' }}
                        />
                        {service}
                      </label>
                    ))}
                  </div>
                  {Array.isArray(formData.services) && formData.services.length > 0 && (
                    <div style={{ paddingTop: '16px', borderTop: '1px solid var(--gray-300)' }}>
                      {formData.services.map(service => (
                        <div key={service} style={{ marginBottom: '12px', border: '1px solid var(--gray-300)', borderRadius: '6px', overflow: 'hidden' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedServices({...expandedServices, [service]: !expandedServices[service]})
                            }}
                            style={{
                              width: '100%',
                              padding: '12px',
                              backgroundColor: 'var(--gray-100)',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontWeight: '500',
                              textAlign: 'left',
                              transition: 'background-color 0.2s'
                            }}
                            className="service-toggle-btn"
                          >
                            <span>{service} Details</span>
                            <span style={{ fontSize: '18px' }}>{expandedServices[service] ? '−' : '+'}</span>
                          </button>
                          {expandedServices[service] && (
                            <div style={{ padding: '12px', backgroundColor: 'white', borderTop: '1px solid var(--gray-300)' }}>
                              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
                                {service === 'Performance' && 'Performance Details (e.g., duration in minutes, number of songs, type of performance)'}
                                {service === 'Appearance' && 'Appearance Details (e.g., location, duration, type of appearance)'}
                                {service === 'Social Media Program' && 'Social Media Details (e.g., number of posts, platforms, posting schedule)'}
                              </label>
                              <textarea
                                value={formData.serviceDetails && formData.serviceDetails[service] ? formData.serviceDetails[service] : ''}
                                onChange={(e) => setFormData({...formData, serviceDetails: {...(formData.serviceDetails || {}), [service]: e.target.value}})}
                                placeholder={
                                  service === 'Performance' ? 'E.g., 5 minute performance, 3 songs, live music' :
                                  service === 'Appearance' ? 'E.g., In-store appearance, 2 hours, mall event' :
                                  'E.g., 5 Instagram posts, 3 TikTok videos, posting 2x per week'
                                }
                                style={{
                                  width: '100%',
                                  minHeight: '80px',
                                  padding: '8px',
                                  border: '1px solid var(--gray-300)',
                                  borderRadius: '4px',
                                  fontFamily: 'inherit',
                                  resize: 'vertical'
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {Array.isArray(formData.services) && formData.services.includes('Appearance') && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-300)' }}>
                      <label>Appearance Location</label>
                      <input type="text" placeholder="e.g., In-store, Event, Commercial shoot" value={formData.appearanceLocation} onChange={(e) => setFormData({...formData, appearanceLocation: e.target.value})} />
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Usage Rights</label>
                  <input type="text" value={formData.usageRights} onChange={(e) => setFormData({...formData, usageRights: e.target.value})} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} style={{ minHeight: '80px', resize: 'vertical' }} />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>File Attachments (Contracts, Invoices, PDFs)</label>
                  <div style={{ marginBottom: '12px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                      style={{ padding: '8px 16px', marginBottom: '12px' }}
                    >
                      + Add Files
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      style={{ display: 'none' }}
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    />
                  </div>
                  {formData.fileAttachments && formData.fileAttachments.length > 0 && (
                    <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '12px' }}>
                      {formData.fileAttachments.map((file, idx) => (
                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '8px', marginBottom: '8px', borderBottom: idx < formData.fileAttachments.length - 1 ? '1px solid var(--gray-200)' : 'none' }}>
                          <div>
                            <p style={{ margin: '0 0 2px 0', fontWeight: '500', fontSize: '14px' }}>📎 {file.name}</p>
                            <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)' }}>{(file.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => downloadFile(file)}
                              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '14px', padding: '4px 8px', textDecoration: 'underline' }}
                            >
                              Download
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFile(idx)}
                              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '18px', padding: 0 }}
                            >
                              ×
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Agency</label>
                  <input type="text" placeholder="e.g., CAA, WME, Gersh" value={formData.agency} onChange={(e) => setFormData({...formData, agency: e.target.value})} />
                </div>

                <div style={{ gridColumn: '1 / -1', borderTop: '2px solid var(--gray-300)', paddingTop: '20px', marginTop: '24px' }}>
                  <h3 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>Deal Timeline</h3>
                  <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                    <div className="form-group">
                      <label>Brand Reached Out</label>
                      <input type="date" value={formData.brandReachedOutDate} onChange={(e) => setFormData({...formData, brandReachedOutDate: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Suggestions Shared</label>
                      <input type="date" value={formData.suggestionsSharedDate} onChange={(e) => setFormData({...formData, suggestionsSharedDate: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Offer Made</label>
                      <input type="date" value={formData.offerMadeDate} onChange={(e) => setFormData({...formData, offerMadeDate: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Contract Signed</label>
                      <input type="date" value={formData.contractSignedDate} onChange={(e) => setFormData({...formData, contractSignedDate: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Services Completed</label>
                      <input type="date" value={formData.servicesCompletedDate} onChange={(e) => setFormData({...formData, servicesCompletedDate: e.target.value})} />
                    </div>
                    <div className="form-group">
                      <label>Payment Date</label>
                      <input type="date" value={formData.paymentDate} onChange={(e) => setFormData({...formData, paymentDate: e.target.value})} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showContactModal && (
        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New Contact</h2>
            <form onSubmit={handleAddContact}>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={newContactData.name} onChange={(e) => setNewContactData({...newContactData, name: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={newContactData.email} onChange={(e) => setNewContactData({...newContactData, email: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={newContactData.phone} onChange={(e) => setNewContactData({...newContactData, phone: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Company</label>
                  <input type="text" value={newContactData.company} onChange={(e) => setNewContactData({...newContactData, company: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Title</label>
                  <input type="text" value={newContactData.title} onChange={(e) => setNewContactData({...newContactData, title: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select value={newContactData.type} onChange={(e) => setNewContactData({...newContactData, type: e.target.value})}>
                    <option value="">Select type</option>
                    <option value="Rep">Rep</option>
                    <option value="Brand">Brand</option>
                    <option value="Talent">Talent</option>
                  </select>
                  {contactModalContext === 'brand' && newContactData.type === '' && (
                    <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '4px' }}>Recommended: Brand</div>
                  )}
                  {contactModalContext === 'talent' && newContactData.type === '' && (
                    <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '4px' }}>Recommended: Rep</div>
                  )}
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Notes</label>
                  <textarea value={newContactData.notes} onChange={(e) => setNewContactData({...newContactData, notes: e.target.value})} style={{ minHeight: '80px', resize: 'vertical' }} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowContactModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Contact</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '20px', minHeight: '600px' }}>
        {['Qualified Lead', 'Initial Outreach', 'Client Review', 'Offer Submitted', 'Offer Accepted', 'Contract Signed', 'Closed Won', 'Closed Lost'].map(status => {
          const statusDeals = filteredDeals.filter(d => d.status === status)
          return (
            <div key={status} style={{ backgroundColor: 'var(--gray-50)', borderRadius: '8px', padding: '16px', border: '1px solid var(--gray-300)', minWidth: '300px', flex: '0 0 300px' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px' }}>{status} ({statusDeals.length})</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '500px', overflowY: 'auto' }}>
                {statusDeals.map(deal => (
                  <div key={deal.id} style={{ backgroundColor: 'white', borderRadius: '6px', padding: '12px', border: '1px solid var(--gray-300)', cursor: 'pointer' }} onClick={() => toggleDealExpand(deal.id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div style={{ flex: 1 }}>
                        <p
                          style={{ margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '14px', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={(e) => { e.stopPropagation(); setProfileView('brand'); setSelectedBrand(deal.brand) }}
                        >
                          {deal.brand}
                        </p>
                        <p
                          style={{ margin: '0', fontSize: '13px', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={(e) => { e.stopPropagation(); setProfileView('talent'); setSelectedTalent(deal.talent) }}
                        >
                          {deal.talent || 'No talent assigned'}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selected.has(deal.id)}
                        onChange={(e) => {
                          e.stopPropagation()
                          toggleSelect(deal.id)
                        }}
                      />
                    </div>
                    {expandedDeals.has(deal.id) && (
                      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-300)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Owner</p>
                            <p style={{ margin: '0', fontSize: '12px' }}>{deal.dealOwnerName}</p>
                          </div>
                          <div>
                            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Contact</p>
                            <p style={{ margin: '0', fontSize: '12px' }}>{getContactName(deal.contactId)}</p>
                          </div>
                          <div>
                            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Date</p>
                            <p style={{ margin: '0', fontSize: '12px' }}>{new Date(deal.dealDate).toLocaleDateString()}</p>
                          </div>
                          {deal.agency && (
                            <div>
                              <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Agency</p>
                              <p style={{ margin: '0', fontSize: '12px', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline' }} onClick={(e) => { e.stopPropagation() }}>
                                {deal.agency}
                              </p>
                            </div>
                          )}
                          {deal.repForTalent && (
                            <div>
                              <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Rep for Talent</p>
                              <p style={{ margin: '0', fontSize: '12px' }}>{deal.repForTalent}</p>
                            </div>
                          )}
                        </div>
                        {(deal.brandReachedOutDate || deal.suggestionsSharedDate || deal.offerMadeDate || deal.contractSignedDate || deal.servicesCompletedDate || deal.paymentDate) && (
                          <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-200)' }}>
                            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Timeline</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px' }}>
                              {deal.brandReachedOutDate && <p style={{ margin: 0 }}><strong>Brand Reached Out:</strong> {new Date(deal.brandReachedOutDate).toLocaleDateString()}</p>}
                              {deal.suggestionsSharedDate && <p style={{ margin: 0 }}><strong>Suggestions Shared:</strong> {new Date(deal.suggestionsSharedDate).toLocaleDateString()}</p>}
                              {deal.offerMadeDate && <p style={{ margin: 0 }}><strong>Offer Made:</strong> {new Date(deal.offerMadeDate).toLocaleDateString()}</p>}
                              {deal.contractSignedDate && <p style={{ margin: 0 }}><strong>Contract Signed:</strong> {new Date(deal.contractSignedDate).toLocaleDateString()}</p>}
                              {deal.servicesCompletedDate && <p style={{ margin: 0 }}><strong>Services Completed:</strong> {new Date(deal.servicesCompletedDate).toLocaleDateString()}</p>}
                              {deal.paymentDate && <p style={{ margin: 0 }}><strong>Payment Date:</strong> {new Date(deal.paymentDate).toLocaleDateString()}</p>}
                            </div>
                          </div>
                        )}
                        {deal.services && (
                          <div style={{ marginBottom: '8px' }}>
                            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Services</p>
                            <p style={{ margin: '0', fontSize: '12px' }}>{Array.isArray(deal.services) ? deal.services.join(', ') : deal.services}</p>
                          </div>
                        )}
                        {deal.notes && (
                          <div style={{ marginBottom: '8px' }}>
                            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Notes</p>
                            <p style={{ margin: '0', fontSize: '12px' }}>{deal.notes}</p>
                          </div>
                        )}
                        {deal.fileAttachments && deal.fileAttachments.length > 0 && (
                          <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-200)' }}>
                            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Files ({deal.fileAttachments.length})</p>
                            <input
                              type="text"
                              placeholder="Search files..."
                              value={dealFileSearch}
                              onChange={(e) => setDealFileSearch(e.target.value)}
                              style={{ width: '100%', padding: '4px 8px', fontSize: '11px', marginBottom: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                            />
                            {deal.fileAttachments.filter(file => file.name.toLowerCase().includes(dealFileSearch.toLowerCase())).map((file, idx) => (
                              <div key={idx} style={{ fontSize: '11px', margin: '6px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: 'var(--primary)' }}>📎 {file.name}</span>
                                <button
                                  type="button"
                                  onClick={() => downloadFile(file)}
                                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '10px', padding: '2px 6px', textDecoration: 'underline' }}
                                >
                                  Download
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {isAdmin && (
                          <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                              <div>
                                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Paid to Talent</p>
                                <p style={{ margin: '0', fontSize: '12px' }}>${deal.feePaid || 0}</p>
                              </div>
                              <div>
                                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Charged to Client</p>
                                <p style={{ margin: '0', fontSize: '12px' }}>${deal.feeCharged || 0}</p>
                              </div>
                              <div style={{ gridColumn: '1 / -1' }}>
                                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--success)' }}>Net Profit</p>
                                <p style={{ margin: '0', fontSize: '12px', color: 'var(--success)', fontWeight: 'bold' }}>${netProfit(deal)}</p>
                              </div>
                            </div>
                          </>
                        )}
                        <div style={{ marginTop: '12px', display: 'flex', gap: '4px' }}>
                          <button className="btn btn-small btn-primary" onClick={(e) => { e.stopPropagation(); openEdit(deal) }}>Edit</button>
                          <button className="btn btn-small btn-danger" onClick={(e) => { e.stopPropagation(); handleDelete(deal.id) }}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ContactsPage({ contacts, user, onReload, isAdmin, exportContactsAsCSV }) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const fileInputRef = React.useRef(null)

  const [formData, setFormData] = useState({
    name: '',
    type: '',
    title: '',
    company: '',
    email: '',
    phone: '',
    notes: ''
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editingId) {
        await updateDoc(doc(db, 'contacts', editingId), formData)
      } else {
        await addDoc(collection(db, 'contacts'), {
          ...formData,
          userId: user.uid,
          createdAt: new Date()
        })
      }
      onReload()
      resetForm()
    } catch (error) {
      alert('Error saving contact: ' + error.message)
    }
  }

  const resetForm = () => {
    setFormData({ name: '', type: '', title: '', company: '', email: '', phone: '', notes: '' })
    setEditingId(null)
    setShowForm(false)
  }

  const handleDelete = async (id) => {
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm('Delete this contact?')) {
      try {
        await deleteDoc(doc(db, 'contacts', id))
        onReload()
      } catch (error) {
        alert('Error deleting contact')
      }
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    setImporting(true)
    setImportProgress('Reading file...')

    try {
      const fileType = file.name.toLowerCase().endsWith('.xlsx') ? 'excel' : 'csv'
      let contactsToImport = []

      if (fileType === 'excel') {
        const arrayBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(arrayBuffer, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const rawData = XLSX.utils.sheet_to_json(worksheet)

        contactsToImport = rawData.map(row => {
          const email = Object.values(row)[0] || ''
          return {
            name: email.split('@')[0],
            email: email.trim(),
            type: '',
            title: '',
            company: '',
            phone: '',
            notes: ''
          }
        }).filter(c => c.email && c.email.includes('@'))
      } else {
        const text = await file.text()
        const lines = text.trim().split('\n')
        const headers = lines[0].split('","').map(h => h.replace(/"/g, ''))

        contactsToImport = lines.slice(1).map(line => {
          const parts = line.split('","').map(p => p.replace(/"/g, ''))
          const obj = {}
          headers.forEach((header, idx) => {
            obj[header] = parts[idx] || ''
          })
          return obj
        }).filter(c => c['Lead Name'] || c['Associated Contact']).map(c => {
          const email = c['Associated Contact']?.match(/\(([^)]+)\)/)?.[1] || ''
          return {
            name: c['Lead Name'] || '',
            email: email,
            type: '',
            title: c['Associated contact job title'] || '',
            company: c['Associated company'] || '',
            phone: '',
            notes: ''
          }
        })
      }

      setImportProgress(`Preparing ${contactsToImport.length} contacts...`)

      const batchSize = 20
      let importedCount = 0

      const processContactBatch = async (contactData) => {
        if (!contactData.email || !contactData.email.trim()) {
          return false
        }
        try {
          await addDoc(collection(db, 'contacts'), {
            ...contactData,
            userId: user.uid,
            createdAt: new Date()
          })
          return true
        } catch (err) {
          console.error('Error importing contact:', err)
          return false
        }
      }

      for (let i = 0; i < contactsToImport.length; i += batchSize) {
        const batch = contactsToImport.slice(i, i + batchSize)
        const promises = batch.map(processContactBatch)
        const results = await Promise.all(promises)
        importedCount += results.filter(r => r).length
        setImportProgress(`Imported ${Math.min(i + batchSize, contactsToImport.length)} of ${contactsToImport.length} contacts...`)
      }

      setImportProgress(`Successfully imported ${importedCount} contacts!`)
      setTimeout(() => {
        setImporting(false)
        setImportProgress('')
        onReload()
        if (fileInputRef.current) fileInputRef.current.value = ''
      }, 1500)
    } catch (error) {
      alert('Error importing file: ' + error.message)
      setImporting(false)
      setImportProgress('')
    }
  }

  const openEdit = (contact) => {
    setFormData(contact)
    setEditingId(contact.id)
    setShowForm(true)
  }

  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  )

  const hasSearched = search.trim().length > 0

  return (
    <div>
      <div className="page-header">
        <h1>Contacts</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-primary" onClick={() => { resetForm(); setShowForm(true) }}>
            New Contact
          </button>
          <button className="btn btn-secondary" onClick={exportContactsAsCSV}>
            Export Contacts
          </button>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
              {importing ? 'Importing...' : 'Import File'}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            onChange={handleImportFile}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {importProgress && (
        <div style={{ padding: '12px 16px', backgroundColor: '#eff6ff', borderRadius: '6px', marginBottom: '16px', fontSize: '14px', color: 'var(--primary)', fontWeight: '500' }}>
          {importProgress}
        </div>
      )}

      <div className="search-bar" style={{ marginBottom: '20px' }}>
        <input type="text" placeholder="Search by name, email..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--gray-300)', borderRadius: '6px', width: '100%' }} />
      </div>

      {!hasSearched && (
        <div className="empty-state" style={{ padding: '60px 40px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--gray-300)' }}>
          <p style={{ fontSize: '16px', color: 'var(--gray-600)', margin: '0' }}>Start typing to search for a contact</p>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? 'Edit Contact' : 'New Contact'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <select value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}>
                    <option value="">Select type</option>
                    <option value="Rep">Rep</option>
                    <option value="Brand">Brand</option>
                    <option value="Talent">Talent</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Title</label>
                  <input type="text" value={formData.title} onChange={(e) => setFormData({...formData, title: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Company</label>
                  <input type="text" value={formData.company} onChange={(e) => setFormData({...formData, company: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input type="tel" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Notes</label>
                  <textarea value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} style={{ minHeight: '100px', resize: 'vertical' }} />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {hasSearched && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filteredContacts.length === 0 ? (
            <div className="empty-state">No contacts found</div>
          ) : (
            filteredContacts.map(contact => (
            <div key={contact.id} style={{ backgroundColor: 'white', border: '1px solid var(--gray-300)', borderRadius: '6px', overflow: 'hidden' }}>
              <div
                onClick={() => setExpandedId(expandedId === contact.id ? null : contact.id)}
                style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--gray-50)' }}
              >
                <div>
                  <p style={{ margin: '0', fontWeight: 'bold', fontSize: '14px' }}>{contact.name}</p>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--gray-600)' }}>{contact.type || contact.email || '-'}</p>
                </div>
                <span style={{ fontSize: '18px' }}>{expandedId === contact.id ? '▼' : '▶'}</span>
              </div>
              {expandedId === contact.id && (
                <div style={{ padding: '16px', backgroundColor: 'white', borderTop: '1px solid var(--gray-300)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: 'bold' }}>Email</p>
                      <p style={{ margin: '0', fontSize: '14px' }}>{contact.email || '-'}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: 'bold' }}>Phone</p>
                      <p style={{ margin: '0', fontSize: '14px' }}>{contact.phone || '-'}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: 'bold' }}>Title</p>
                      <p style={{ margin: '0', fontSize: '14px' }}>{contact.title || '-'}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: 'bold' }}>Company</p>
                      <p style={{ margin: '0', fontSize: '14px' }}>{contact.company || '-'}</p>
                    </div>
                  </div>
                  {contact.notes && (
                    <div style={{ marginBottom: '16px' }}>
                      <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: 'bold' }}>Notes</p>
                      <p style={{ margin: '0', fontSize: '14px' }}>{contact.notes}</p>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-small btn-primary" onClick={() => openEdit(contact)}>Edit</button>
                    <button className="btn btn-small btn-danger" onClick={() => handleDelete(contact.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))
          )}
        </div>
      )}
    </div>
  )
}

function UsersPage({ isAdmin, onUserRemoved }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingUser, setEditingUser] = useState(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    if (isAdmin) {
      loadUsers()
    }
  }, [isAdmin])

  const loadUsers = async () => {
    try {
      const snapshot = await getDocs(collection(db, 'users'))
      const userList = snapshot.docs.map(u => ({ id: u.id, ...u.data() }))
      userList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      setUsers(userList)
    } catch (error) {
      console.error('Error loading users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveUser = async (userId, userEmail) => {
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm(`Remove ${userEmail} from the team?`)) {
      try {
        await deleteDoc(doc(db, 'users', userId))
        setUsers(users.filter(u => u.id !== userId))
      } catch (error) {
        alert('Error removing user: ' + error.message)
      }
    }
  }

  const handleToggleStatus = async (userId, currentStatus) => {
    try {
      const newStatus = currentStatus === 'active' ? 'inactive' : 'active'
      await updateDoc(doc(db, 'users', userId), { status: newStatus })
      loadUsers()
    } catch (error) {
      alert('Error updating user: ' + error.message)
    }
  }

  const handleDeleteAllDeals = async (userEmail) => {
    // eslint-disable-next-line no-restricted-globals
    if (window.confirm(`Delete ALL deals for ${userEmail}? This cannot be undone.`)) {
      try {
        const dealsSnapshot = await getDocs(query(collection(db, 'deals'), where('dealOwnerEmail', '==', userEmail)))
        let deletedCount = 0
        for (const dealDoc of dealsSnapshot.docs) {
          await deleteDoc(doc(db, 'deals', dealDoc.id))
          // Log activity
          await addDoc(collection(db, 'activity'), {
            type: 'deal_deleted',
            user: isAdmin ? 'Admin' : 'Unknown',
            userEmail: userEmail,
            dealId: dealDoc.id,
            dealBrand: dealDoc.data().brand,
            dealTalent: dealDoc.data().talent,
            bulkDelete: true,
            bulkDeleteUser: userEmail,
            timestamp: new Date()
          })
          deletedCount++
        }
        alert(`Deleted ${deletedCount} deals for ${userEmail}`)
      } catch (error) {
        alert('Error deleting deals: ' + error.message)
      }
    }
  }

  const handleEditName = (user) => {
    setEditingUser(user)
    setEditName(user.name || '')
  }

  const handleSaveName = async () => {
    if (!editName.trim()) {
      alert('Name cannot be empty')
      return
    }
    try {
      await updateDoc(doc(db, 'users', editingUser.id), { name: editName })
      setEditingUser(null)
      setEditName('')
      loadUsers()
    } catch (error) {
      alert('Error updating name: ' + error.message)
    }
  }

  if (!isAdmin) {
    return <div style={{ padding: '40px', textAlign: 'center' }}>Access denied</div>
  }

  return (
    <div>
      <h1>Team Members</h1>

      {loading ? (
        <p>Loading users...</p>
      ) : users.length === 0 ? (
        <p style={{ color: 'var(--gray-600)' }}>No team members yet</p>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Signed Up</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td><strong>{u.name || '(no name)'}</strong></td>
                  <td>{u.email}</td>
                  <td>{u.createdAt ? new Date(u.createdAt.seconds ? u.createdAt.seconds * 1000 : u.createdAt).toLocaleDateString() : '-'}</td>
                  <td>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      backgroundColor: u.status === 'active' ? '#dcfce7' : '#fee2e2',
                      color: u.status === 'active' ? '#166534' : '#991b1b'
                    }}>
                      {u.status || 'active'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-small"
                      onClick={() => handleEditName(u)}
                      style={{ backgroundColor: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe' }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => handleToggleStatus(u.id, u.status)}
                    >
                      {u.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => handleDeleteAllDeals(u.email)}
                      style={{ backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #f59e0b' }}
                    >
                      Delete Deals
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleRemoveUser(u.id, u.email)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 20px 0' }}>Edit Team Member Name</h2>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>Email</label>
              <input
                type="email"
                value={editingUser.email}
                disabled
                style={{
                  padding: '10px 12px',
                  border: '1px solid var(--gray-300)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'var(--gray-100)',
                  color: 'var(--gray-600)',
                  cursor: 'not-allowed'
                }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label>Full Name</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Enter full name"
                style={{
                  padding: '10px 12px',
                  border: '1px solid var(--gray-300)',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setEditingUser(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveName}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UsagePage({ isAdmin }) {
  const [users, setUsers] = useState([])
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUsageData()
  }, [])

  const loadUsageData = async () => {
    try {
      // Load users with last login info
      const usersSnapshot = await getDocs(collection(db, 'users'))
      const usersList = usersSnapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      setUsers(usersList)

      // Load activity log
      const activitySnapshot = await getDocs(query(collection(db, 'activity'), orderBy('timestamp', 'desc')))
      const activityList = activitySnapshot.docs.map(d => ({ id: d.id, ...d.data() }))
      setActivities(activityList)
    } catch (error) {
      console.error('Error loading usage data:', error)
    }
    setLoading(false)
  }

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>

  return (
    <div style={{ padding: '20px' }}>
      <h1>Usage & Activity</h1>

      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ marginBottom: '20px' }}>Team Member Activity</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Team Member</th>
                <th>Email</th>
                <th>Signed Up</th>
                <th>Last Login</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan="5" style={{ textAlign: 'center' }}>No users yet</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.email.split('@')[0]}</strong></td>
                    <td>{u.email}</td>
                    <td>{u.createdAt ? new Date(u.createdAt.toDate?.() || u.createdAt).toLocaleDateString() : '-'}</td>
                    <td>{u.lastLogin ? new Date(u.lastLogin.toDate?.() || u.lastLogin).toLocaleDateString() : 'Never'}</td>
                    <td style={{ color: u.status === 'active' ? 'var(--success)' : 'var(--gray-600)' }}>
                      <strong>{u.status || 'active'}</strong>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 style={{ marginBottom: '20px' }}>Recent Activity</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 ? (
                <tr><td colSpan="4" style={{ textAlign: 'center' }}>No activity yet</td></tr>
              ) : (
                activities.map(a => (
                  <tr key={a.id}>
                    <td style={{ fontSize: '12px' }}>{new Date(a.timestamp.toDate?.() || a.timestamp).toLocaleString()}</td>
                    <td>{a.user}</td>
                    <td style={{ textTransform: 'capitalize' }}>{a.type.replace('_', ' ')}</td>
                    <td style={{ fontSize: '12px', color: 'var(--gray-600)' }}>
                      {a.dealBrand && `${a.dealBrand} - ${a.dealTalent}`}
                      {a.bulkDelete && ` (bulk delete for ${a.bulkDeleteUser})`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function TalentProfileView({ talentName, deals, contacts, onBack, isAdmin, getContactName, netProfit }) {
  const talentDeals = deals.filter(d => d.talent === talentName)
  const relatedBrands = Array.from(new Set(talentDeals.map(d => d.brand).filter(Boolean)))
  const [expandedDeals, setExpandedDeals] = React.useState(new Set())

  const toggleDealExpand = (dealId) => {
    const newExpanded = new Set(expandedDeals)
    if (newExpanded.has(dealId)) {
      newExpanded.delete(dealId)
    } else {
      newExpanded.add(dealId)
    }
    setExpandedDeals(newExpanded)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '18px', marginRight: '12px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ display: 'inline-block', margin: 0 }}>Talent: {talentName}</h1>
        </div>
      </div>

      <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--gray-300)' }}>
        <p style={{ margin: '0 0 8px 0', color: 'var(--gray-600)', fontSize: '14px' }}>{talentDeals.length} deal(s) found</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
          <div>
            <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Deals</p>
            <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold' }}>{talentDeals.length}</p>
          </div>
          {isAdmin && (
            <>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Fees Paid</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--success)' }}>
                  ${talentDeals.reduce((sum, d) => sum + (d.feePaid || 0), 0)}
                </p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Revenue</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>
                  ${talentDeals.reduce((sum, d) => sum + (d.feeCharged || 0), 0)}
                </p>
              </div>
            </>
          )}
        </div>
        {relatedBrands.length > 0 && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-300)' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Brands Worked With ({relatedBrands.length})</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {relatedBrands.map(brand => (
                <span key={brand} style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '500' }}>
                  {brand}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {talentDeals.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--gray-300)', textAlign: 'center' }}>
            <p style={{ margin: '0', color: 'var(--gray-600)' }}>No deals for this talent</p>
          </div>
        ) : (
          talentDeals.map(deal => (
            <div
              key={deal.id}
              style={{ backgroundColor: 'white', borderRadius: '6px', padding: '16px', border: '1px solid var(--gray-300)', cursor: 'pointer' }}
              onClick={() => toggleDealExpand(deal.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '15px' }}>{deal.brand}</p>
                  <p style={{ margin: '0', fontSize: '13px', color: 'var(--gray-600)' }}>{deal.status}</p>
                </div>
                <span style={{ fontSize: '18px' }}>{expandedDeals.has(deal.id) ? '▼' : '▶'}</span>
              </div>

              {expandedDeals.has(deal.id) && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-300)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Owner</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.dealOwnerName}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Date</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{new Date(deal.dealDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {deal.notes && (
                    <div style={{ marginBottom: '8px' }}>
                      <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Notes</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.notes}</p>
                    </div>
                  )}
                  {isAdmin && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Paid</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feePaid || 0}</p>
                      </div>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Charged</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feeCharged || 0}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function BrandProfileView({ brandName, deals, contacts, onBack, isAdmin, getContactName, netProfit }) {
  const brandDeals = deals.filter(d => d.brand === brandName)
  const relatedTalents = Array.from(new Set(brandDeals.map(d => d.talent).filter(Boolean)))
  const [expandedDeals, setExpandedDeals] = React.useState(new Set())

  const toggleDealExpand = (dealId) => {
    const newExpanded = new Set(expandedDeals)
    if (newExpanded.has(dealId)) {
      newExpanded.delete(dealId)
    } else {
      newExpanded.add(dealId)
    }
    setExpandedDeals(newExpanded)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '18px', marginRight: '12px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ display: 'inline-block', margin: 0 }}>Brand: {brandName}</h1>
        </div>
      </div>

      <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--gray-300)' }}>
        <p style={{ margin: '0 0 8px 0', color: 'var(--gray-600)', fontSize: '14px' }}>{brandDeals.length} deal(s) found</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
          <div>
            <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Deals</p>
            <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold' }}>{brandDeals.length}</p>
          </div>
          {isAdmin && (
            <>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Talent Fees</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--danger)' }}>
                  ${brandDeals.reduce((sum, d) => sum + (d.feePaid || 0), 0)}
                </p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Revenue</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>
                  ${brandDeals.reduce((sum, d) => sum + (d.feeCharged || 0), 0)}
                </p>
              </div>
            </>
          )}
        </div>
        {relatedTalents.length > 0 && (
          <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-300)' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Talents Booked ({relatedTalents.length})</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {relatedTalents.map(talent => (
                <span key={talent} style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '500' }}>
                  {talent}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {brandDeals.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--gray-300)', textAlign: 'center' }}>
            <p style={{ margin: '0', color: 'var(--gray-600)' }}>No deals for this brand</p>
          </div>
        ) : (
          brandDeals.map(deal => (
            <div
              key={deal.id}
              style={{ backgroundColor: 'white', borderRadius: '6px', padding: '16px', border: '1px solid var(--gray-300)', cursor: 'pointer' }}
              onClick={() => toggleDealExpand(deal.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '15px' }}>{deal.talent}</p>
                  <p style={{ margin: '0', fontSize: '13px', color: 'var(--gray-600)' }}>{deal.status}</p>
                </div>
                <span style={{ fontSize: '18px' }}>{expandedDeals.has(deal.id) ? '▼' : '▶'}</span>
              </div>

              {expandedDeals.has(deal.id) && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-300)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Owner</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.dealOwnerName}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Date</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{new Date(deal.dealDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {deal.notes && (
                    <div style={{ marginBottom: '8px' }}>
                      <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Notes</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.notes}</p>
                    </div>
                  )}
                  {isAdmin && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Paid</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feePaid || 0}</p>
                      </div>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Charged</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feeCharged || 0}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function AgencyProfileView({ agencyName, deals, contacts, onBack, isAdmin, getContactName, netProfit }) {
  const agencyDeals = deals.filter(d => d.agency === agencyName)
  const relatedBrands = Array.from(new Set(agencyDeals.map(d => d.brand).filter(Boolean)))
  const relatedTalents = Array.from(new Set(agencyDeals.map(d => d.talent).filter(Boolean)))
  const [expandedDeals, setExpandedDeals] = React.useState(new Set())

  const toggleDealExpand = (dealId) => {
    const newExpanded = new Set(expandedDeals)
    if (newExpanded.has(dealId)) {
      newExpanded.delete(dealId)
    } else {
      newExpanded.add(dealId)
    }
    setExpandedDeals(newExpanded)
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '18px', marginRight: '12px', padding: 0 }}>
            ← Back
          </button>
          <h1 style={{ display: 'inline-block', margin: 0 }}>Agency: {agencyName}</h1>
        </div>
      </div>

      <div style={{ padding: '16px', backgroundColor: 'white', borderRadius: '8px', marginBottom: '20px', border: '1px solid var(--gray-300)' }}>
        <p style={{ margin: '0 0 8px 0', color: 'var(--gray-600)', fontSize: '14px' }}>{agencyDeals.length} deal(s) found</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '16px' }}>
          <div>
            <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Deals</p>
            <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold' }}>{agencyDeals.length}</p>
          </div>
          {isAdmin && (
            <>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Talent Fees</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--danger)' }}>
                  ${agencyDeals.reduce((sum, d) => sum + (d.feePaid || 0), 0)}
                </p>
              </div>
              <div>
                <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Revenue</p>
                <p style={{ margin: '8px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: 'var(--primary)' }}>
                  ${agencyDeals.reduce((sum, d) => sum + (d.feeCharged || 0), 0)}
                </p>
              </div>
            </>
          )}
        </div>
        <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-300)' }}>
          {relatedBrands.length > 0 && (
            <div style={{ marginBottom: '12px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Brands ({relatedBrands.length})</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {relatedBrands.map(brand => (
                  <span key={brand} style={{ backgroundColor: 'var(--primary)', color: 'white', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '500' }}>
                    {brand}
                  </span>
                ))}
              </div>
            </div>
          )}
          {relatedTalents.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Talents ({relatedTalents.length})</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {relatedTalents.map(talent => (
                  <span key={talent} style={{ backgroundColor: 'var(--success)', color: 'white', padding: '4px 12px', borderRadius: '16px', fontSize: '12px', fontWeight: '500' }}>
                    {talent}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {agencyDeals.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px', backgroundColor: 'white', borderRadius: '8px', border: '1px solid var(--gray-300)', textAlign: 'center' }}>
            <p style={{ margin: '0', color: 'var(--gray-600)' }}>No deals for this agency</p>
          </div>
        ) : (
          agencyDeals.map(deal => (
            <div
              key={deal.id}
              style={{ backgroundColor: 'white', borderRadius: '6px', padding: '16px', border: '1px solid var(--gray-300)', cursor: 'pointer' }}
              onClick={() => toggleDealExpand(deal.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: 'bold', fontSize: '15px' }}>{deal.brand}</p>
                  <p style={{ margin: '0 0 2px 0', fontSize: '12px', color: 'var(--gray-600)' }}>{deal.talent}</p>
                  <p style={{ margin: '0', fontSize: '13px', color: 'var(--gray-600)' }}>{deal.status}</p>
                </div>
                <span style={{ fontSize: '18px' }}>{expandedDeals.has(deal.id) ? '▼' : '▶'}</span>
              </div>

              {expandedDeals.has(deal.id) && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--gray-300)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Owner</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.dealOwnerName}</p>
                    </div>
                    <div>
                      <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Date</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{new Date(deal.dealDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  {deal.notes && (
                    <div style={{ marginBottom: '8px' }}>
                      <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Notes</p>
                      <p style={{ margin: '0', fontSize: '12px' }}>{deal.notes}</p>
                    </div>
                  )}
                  {isAdmin && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Paid</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feePaid || 0}</p>
                      </div>
                      <div>
                        <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Fee Charged</p>
                        <p style={{ margin: '0', fontSize: '12px' }}>${deal.feeCharged || 0}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function FileSearchPage({ deals, downloadFile, exportDocuments, user }) {
  const [fileSearch, setFileSearch] = useState('')
  const [expandedDeals, setExpandedDeals] = useState({})

  // Group files by deal
  const dealFilesMap = {}
  const ADMIN_EMAIL = 'matt@talentresources.com'
  deals.forEach(deal => {
    if (deal.fileAttachments && deal.fileAttachments.length > 0) {
      const dealKey = deal.id
      const visibleFiles = deal.fileAttachments.filter(file => {
        if (file.uploadedBy === ADMIN_EMAIL && user.email !== ADMIN_EMAIL) {
          return false
        }
        return true
      })
      if (visibleFiles.length > 0) {
        dealFilesMap[dealKey] = {
          dealName: deal.brand || 'Unknown Brand',
          talent: deal.talent || 'Unknown Talent',
          dealStatus: deal.status || 'Unknown',
          files: visibleFiles.map(file => ({
            ...file,
            dealId: deal.id
          }))
        }
      }
    }
  })

  // Filter deals and files based on search
  const filteredDeals = Object.entries(dealFilesMap).filter(([dealId, dealData]) => {
    const dealMatches =
      dealData.dealName.toLowerCase().includes(fileSearch.toLowerCase()) ||
      dealData.talent.toLowerCase().includes(fileSearch.toLowerCase())

    const hasMatchingFiles = dealData.files.some(file =>
      file.name.toLowerCase().includes(fileSearch.toLowerCase())
    )

    return dealMatches || hasMatchingFiles
  })

  // Filter files within each deal
  const getVisibleFiles = (dealData) => {
    return dealData.files.filter(file =>
      file.name.toLowerCase().includes(fileSearch.toLowerCase()) ||
      dealData.dealName.toLowerCase().includes(fileSearch.toLowerCase()) ||
      dealData.talent.toLowerCase().includes(fileSearch.toLowerCase())
    )
  }

  const toggleDealExpanded = (dealId) => {
    setExpandedDeals(prev => ({
      ...prev,
      [dealId]: !prev[dealId]
    }))
  }

  const totalFiles = Object.values(dealFilesMap).reduce((sum, deal) => sum + deal.files.length, 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: '0', fontSize: '24px', fontWeight: '700' }}>File Search</h1>
        <button className="btn btn-secondary" onClick={exportDocuments}>
          Export Documents
        </button>
      </div>

      <div style={{ marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search files by name, deal, or talent..."
          value={fileSearch}
          onChange={(e) => setFileSearch(e.target.value)}
          style={{ width: '100%', padding: '12px 16px', fontSize: '14px', border: '1px solid var(--gray-300)', borderRadius: '6px', boxSizing: 'border-box' }}
        />
      </div>

      {!fileSearch ? (
        <div style={{
          border: '1px solid var(--gray-300)',
          borderRadius: '6px',
          padding: '32px',
          textAlign: 'center',
          color: 'var(--gray-600)'
        }}>
          <p style={{ fontSize: '14px', margin: '0' }}>Start typing to search for files</p>
        </div>
      ) : totalFiles === 0 ? (
        <p style={{ color: 'var(--gray-600)', textAlign: 'center', padding: '32px' }}>
          No files attached to any deals
        </p>
      ) : filteredDeals.length === 0 ? (
        <p style={{ color: 'var(--gray-600)', textAlign: 'center', padding: '32px' }}>
          No files match your search
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
          {filteredDeals.map(([dealId, dealData]) => {
            const visibleFiles = getVisibleFiles(dealData)
            const isExpanded = expandedDeals[dealId] ?? true // Expanded when search results show

            return (
              <div key={dealId} style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', overflow: 'hidden' }}>
                {/* Deal Header - Collapsible */}
                <div
                  onClick={() => toggleDealExpanded(dealId)}
                  style={{
                    padding: '16px',
                    backgroundColor: 'var(--gray-100)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 4px 0', fontWeight: '600', fontSize: '14px' }}>
                      {isExpanded ? '▼' : '▶'} {dealData.dealName}
                    </p>
                    <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)' }}>
                      Talent: {dealData.talent} | Status: {dealData.dealStatus} | {visibleFiles.length} file(s)
                    </p>
                  </div>
                </div>

                {/* Files - Collapsible Content */}
                {isExpanded && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--gray-300)' }}>
                    {visibleFiles.map((file, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '12px',
                          marginBottom: idx < visibleFiles.length - 1 ? '8px' : '0',
                          backgroundColor: 'var(--gray-50)',
                          borderRadius: '4px'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: '0' }}>
                          <p style={{ margin: '0 0 4px 0', fontWeight: '500', fontSize: '13px', wordBreak: 'break-word' }}>
                            📎 {file.name}
                          </p>
                          <p style={{ margin: '0', fontSize: '11px', color: 'var(--gray-600)' }}>
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadFile(file)}
                          style={{
                            background: 'var(--primary)',
                            color: 'white',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: '500',
                            marginLeft: '12px',
                            flexShrink: 0,
                            whiteSpace: 'nowrap'
                          }}
                        >
                          Download
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PRClientsPage({ prClients, setPrClients, user }) {
  const [showForm, setShowForm] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [teamUsers, setTeamUsers] = useState([])
  const [ownerSearches, setOwnerSearches] = useState({})
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState({})
  const [formData, setFormData] = useState({
    clientName: '',
    monthlyFee: '',
    clientContactName: '',
    clientContactEmail: '',
    clientContactPhone: '',
    accountOwners: [{ name: '', email: '' }],
    contractStartDate: '',
    contractEndDate: '',
    contracts: []
  })
  const contractFileInputRef = React.useRef(null)

  useEffect(() => {
    const loadTeamUsers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'))
        const users = snapshot.docs.map(d => ({
          id: d.id,
          email: d.data().email,
          name: d.data().name || d.data().email.split('@')[0]
        }))
        setTeamUsers(users)
      } catch (error) {
        console.error('Error loading team users:', error)
      }
    }
    loadTeamUsers()
  }, [])

  const filteredClients = prClients.filter(client =>
    client.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    client.clientContactName.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAddClient = async () => {
    if (!formData.clientName || !formData.monthlyFee) {
      alert('Please fill in client name and monthly fee')
      return
    }

    try {
      if (editingId) {
        await updateDoc(doc(db, 'prClients', editingId), {
          ...formData,
          monthlyFee: parseFloat(formData.monthlyFee),
          updatedAt: new Date()
        })
        setPrClients(prClients.map(c => c.id === editingId ? { id: editingId, ...formData, monthlyFee: parseFloat(formData.monthlyFee) } : c))
      } else {
        const docRef = await addDoc(collection(db, 'prClients'), {
          ...formData,
          monthlyFee: parseFloat(formData.monthlyFee),
          createdAt: new Date(),
          updatedAt: new Date()
        })
        setPrClients([...prClients, { id: docRef.id, ...formData, monthlyFee: parseFloat(formData.monthlyFee) }])
      }
      setFormData({
        clientName: '',
        monthlyFee: '',
        clientContactName: '',
        clientContactEmail: '',
        clientContactPhone: '',
        accountOwners: [{ name: '', email: '' }],
        contractStartDate: '',
        contractEndDate: '',
        contracts: []
      })
      setEditingId(null)
      setShowForm(false)
    } catch (error) {
      console.error('Error saving client:', error)
      alert('Error saving client')
    }
  }

  const handleDeleteClient = async (id) => {
    if (window.confirm('Delete this client?')) {
      try {
        await deleteDoc(doc(db, 'prClients', id))
        setPrClients(prClients.filter(c => c.id !== id))
      } catch (error) {
        console.error('Error deleting client:', error)
      }
    }
  }

  const handleContractFileUpload = (e) => {
    const files = e.target.files
    if (!files) return

    Array.from(files).forEach((file) => {
      const reader = new FileReader()
      reader.onload = (event) => {
        const newContract = {
          id: Date.now().toString(),
          name: file.name,
          startDate: '',
          endDate: '',
          fileName: file.name,
          fileData: event.target.result
        }
        setFormData({
          ...formData,
          contracts: [...(formData.contracts || []), newContract]
        })
      }
      reader.readAsDataURL(file)
    })
    if (contractFileInputRef.current) {
      contractFileInputRef.current.value = ''
    }
  }

  const removeContract = (contractId) => {
    setFormData({
      ...formData,
      contracts: formData.contracts.filter(c => c.id !== contractId)
    })
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: '0', fontSize: '24px', fontWeight: '700' }}>Current Clients</h1>
        <button
          onClick={() => {
            setShowForm(!showForm)
            setEditingId(null)
            setFormData({
              clientName: '',
              monthlyFee: '',
              clientContactName: '',
              clientContactEmail: '',
              clientContactPhone: '',
              accountOwners: [{ name: '', email: '' }],
              contractStartDate: '',
              contractEndDate: '',
              contracts: []
            })
          }}
          style={{
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: '500'
          }}
        >
          {showForm ? 'Cancel' : '+ Add Client'}
        </button>
      </div>

      {showForm && (
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', marginBottom: '24px' }}>
          <h2 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600' }}>
            {editingId ? 'Edit Client' : 'New Client'}
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Client Name</label>
              <input
                type="text"
                value={formData.clientName}
                onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                placeholder="Client name"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Monthly Fee ($)</label>
              <input
                type="number"
                value={formData.monthlyFee}
                onChange={(e) => setFormData({ ...formData, monthlyFee: e.target.value })}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                placeholder="0.00"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Client Contact Name</label>
              <input
                type="text"
                value={formData.clientContactName}
                onChange={(e) => setFormData({ ...formData, clientContactName: e.target.value })}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                placeholder="Contact name"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Client Email</label>
              <input
                type="email"
                value={formData.clientContactEmail}
                onChange={(e) => setFormData({ ...formData, clientContactEmail: e.target.value })}
                style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                placeholder="email@example.com"
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>Client Phone</label>
            <input
              type="text"
              value={formData.clientContactPhone}
              onChange={(e) => setFormData({ ...formData, clientContactPhone: e.target.value })}
              style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
              placeholder="Phone number"
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>Account Owners</label>
            {formData.accountOwners.map((owner, idx) => {
              const searchValue = ownerSearches[idx] || ''
              const ownerSuggestions = searchValue.trim() ? teamUsers.filter(u =>
                u.name.toLowerCase().includes(searchValue.toLowerCase()) ||
                u.email.toLowerCase().includes(searchValue.toLowerCase())
              ) : []

              return (
                <div key={idx} style={{ marginBottom: '8px', position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px' }}>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        value={searchValue}
                        onChange={(e) => {
                          setOwnerSearches({ ...ownerSearches, [idx]: e.target.value })
                          setShowOwnerSuggestions({ ...showOwnerSuggestions, [idx]: true })
                        }}
                        onFocus={() => setShowOwnerSuggestions({ ...showOwnerSuggestions, [idx]: true })}
                        placeholder="Search team member..."
                        style={{ width: '100%', padding: '8px', border: '1px solid var(--gray-300)', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                      {showOwnerSuggestions[idx] && ownerSuggestions.length > 0 && (
                        <div style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          backgroundColor: 'white',
                          border: '1px solid var(--gray-300)',
                          borderTop: 'none',
                          borderRadius: '0 0 4px 4px',
                          maxHeight: '150px',
                          overflowY: 'auto',
                          zIndex: 10
                        }}>
                          {ownerSuggestions.map(suggestion => (
                            <div
                              key={suggestion.id}
                              onClick={() => {
                                const newOwners = [...formData.accountOwners]
                                newOwners[idx] = { name: suggestion.name, email: suggestion.email }
                                setFormData({ ...formData, accountOwners: newOwners })
                                setOwnerSearches({ ...ownerSearches, [idx]: '' })
                                setShowOwnerSuggestions({ ...showOwnerSuggestions, [idx]: false })
                              }}
                              style={{
                                padding: '8px',
                                cursor: 'pointer',
                                borderBottom: '1px solid var(--gray-100)',
                                backgroundColor: 'white',
                                fontSize: '12px'
                              }}
                            >
                              <strong>{suggestion.name}</strong>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setFormData({
                          ...formData,
                          accountOwners: formData.accountOwners.filter((_, i) => i !== idx)
                        })
                        const newSearches = { ...ownerSearches }
                        delete newSearches[idx]
                        setOwnerSearches(newSearches)
                      }}
                      style={{
                        background: '#ff6b6b',
                        color: 'white',
                        border: 'none',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                  {owner.name && owner.email && (
                    <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: 'var(--gray-600)' }}>
                      Selected: {owner.name} ({owner.email})
                    </p>
                  )}
                </div>
              )
            })}
            <button
              onClick={() => {
                setFormData({
                  ...formData,
                  accountOwners: [...formData.accountOwners, { name: '', email: '' }]
                })
              }}
              style={{
                background: 'var(--gray-300)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              + Add Owner
            </button>
          </div>

          <div style={{ marginBottom: '16px', borderTop: '1px solid var(--gray-300)', paddingTop: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>Contracts</label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>Contract Start Date</label>
                <input
                  type="date"
                  value={formData.contractStartDate}
                  onChange={(e) => setFormData({ ...formData, contractStartDate: e.target.value })}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '3px', fontSize: '12px' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>Contract End Date</label>
                <input
                  type="date"
                  value={formData.contractEndDate}
                  onChange={(e) => setFormData({ ...formData, contractEndDate: e.target.value })}
                  style={{ width: '100%', padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '3px', fontSize: '12px' }}
                />
              </div>
            </div>

            <input
              ref={contractFileInputRef}
              type="file"
              multiple
              onChange={handleContractFileUpload}
              style={{ display: 'none' }}
              accept="*"
            />
            <button
              type="button"
              onClick={() => contractFileInputRef.current?.click()}
              style={{
                background: 'var(--gray-300)',
                border: 'none',
                padding: '8px 12px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                marginBottom: '12px'
              }}
            >
              📎 Upload Contract
            </button>

            {formData.contracts && formData.contracts.length > 0 && (
              <div style={{ backgroundColor: 'var(--gray-50)', padding: '12px', borderRadius: '4px' }}>
                {formData.contracts.map((contract, idx) => (
                  <div key={contract.id} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: idx < formData.contracts.length - 1 ? '1px solid var(--gray-300)' : 'none' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <p style={{ margin: '0', fontSize: '12px', fontWeight: '500' }}>📄 {contract.fileName}</p>
                      <button
                        type="button"
                        onClick={() => removeContract(contract.id)}
                        style={{
                          background: '#ff6b6b',
                          color: 'white',
                          border: 'none',
                          padding: '4px 8px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '11px'
                        }}
                      >
                        Remove
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <input
                        type="date"
                        value={contract.startDate}
                        onChange={(e) => {
                          const updated = [...formData.contracts]
                          updated[idx].startDate = e.target.value
                          setFormData({ ...formData, contracts: updated })
                        }}
                        placeholder="Start Date"
                        style={{ padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '3px', fontSize: '11px' }}
                      />
                      <input
                        type="date"
                        value={contract.endDate}
                        onChange={(e) => {
                          const updated = [...formData.contracts]
                          updated[idx].endDate = e.target.value
                          setFormData({ ...formData, contracts: updated })
                        }}
                        placeholder="End Date"
                        style={{ padding: '6px', border: '1px solid var(--gray-300)', borderRadius: '3px', fontSize: '11px' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleAddClient}
            style={{
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: '500'
            }}
          >
            {editingId ? 'Update Client' : 'Add Client'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search clients by name or contact..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%', padding: '12px 16px', fontSize: '14px', border: '1px solid var(--gray-300)', borderRadius: '6px', boxSizing: 'border-box' }}
        />
      </div>

      {filteredClients.length === 0 ? (
        <p style={{ color: 'var(--gray-600)', textAlign: 'center', padding: '32px' }}>
          {prClients.length === 0 ? 'No clients yet. Add one to get started.' : 'No clients match your search.'}
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
          {filteredClients.map((client) => (
            <div key={client.id} style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', fontSize: '14px' }}>{client.clientName}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: 'var(--gray-600)' }}>
                    Contact: {client.clientContactName} | {client.clientContactEmail} | {client.clientContactPhone}
                  </p>
                  <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)' }}>
                    Monthly Fee: ${client.monthlyFee?.toFixed(2) || '0.00'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      setFormData(client)
                      setEditingId(client.id)
                      setShowForm(true)
                    }}
                    style={{
                      background: 'var(--primary)',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDeleteClient(client.id)}
                    style={{
                      background: '#ff6b6b',
                      color: 'white',
                      border: 'none',
                      padding: '6px 12px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {client.accountOwners && client.accountOwners.length > 0 && (
                <div style={{ borderTop: '1px solid var(--gray-300)', paddingTop: '12px', marginBottom: '12px' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: '600' }}>Account Owners:</p>
                  {client.accountOwners.map((owner, idx) => (
                    <p key={idx} style={{ margin: '2px 0', fontSize: '11px', color: 'var(--gray-600)' }}>
                      • {owner.name} ({owner.email})
                    </p>
                  ))}
                </div>
              )}
              {client.contracts && client.contracts.length > 0 && (
                <div style={{ borderTop: '1px solid var(--gray-300)', paddingTop: '12px' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '600' }}>Contracts:</p>
                  {client.contracts.map((contract, idx) => (
                    <div key={idx} style={{ fontSize: '11px', color: 'var(--gray-600)', marginBottom: '6px', paddingLeft: '12px' }}>
                      <p style={{ margin: '0', fontWeight: '500' }}>📄 {contract.fileName}</p>
                      <p style={{ margin: '2px 0 0 0', fontSize: '10px' }}>
                        {contract.startDate ? new Date(contract.startDate).toLocaleDateString() : 'No start'} to {contract.endDate ? new Date(contract.endDate).toLocaleDateString() : 'No end'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PRDashboardPage({ prClients }) {
  const totalMonthly = prClients.reduce((sum, client) => sum + (client.monthlyFee || 0), 0)

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: '700' }}>PR Revenue Dashboard</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', backgroundColor: 'var(--gray-50)' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Total Monthly Revenue</p>
          <p style={{ margin: '0', fontSize: '28px', fontWeight: '700', color: 'var(--primary)' }}>
            ${totalMonthly.toFixed(2)}
          </p>
        </div>
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', backgroundColor: 'var(--gray-50)' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Active Clients</p>
          <p style={{ margin: '0', fontSize: '28px', fontWeight: '700', color: 'var(--primary)' }}>
            {prClients.length}
          </p>
        </div>
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', backgroundColor: 'var(--gray-50)' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Average Monthly</p>
          <p style={{ margin: '0', fontSize: '28px', fontWeight: '700', color: 'var(--primary)' }}>
            ${prClients.length > 0 ? (totalMonthly / prClients.length).toFixed(2) : '0.00'}
          </p>
        </div>
      </div>

      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: '700' }}>Clients by Monthly Fee</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
        {prClients
          .sort((a, b) => (b.monthlyFee || 0) - (a.monthlyFee || 0))
          .map((client) => (
            <div key={client.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 16px', border: '1px solid var(--gray-300)', borderRadius: '6px' }}>
              <span>{client.clientName}</span>
              <span style={{ fontWeight: '600' }}>${client.monthlyFee?.toFixed(2) || '0.00'}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function PRContractAlertsPage({ prClients }) {
  const getUpcomingExpirations = () => {
    const today = new Date()

    const alerts = []
    prClients.forEach(client => {
      // Check contract term dates first
      if (client.contractEndDate) {
        const endDate = new Date(client.contractEndDate)
        const daysUntilExpiration = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24))

        if (daysUntilExpiration <= 15 && daysUntilExpiration > 0) {
          alerts.push({
            clientName: client.clientName,
            contractName: 'Contract Term',
            endDate: client.contractEndDate,
            daysUntilExpiration,
            accountOwners: client.accountOwners || [],
            monthlyFee: client.monthlyFee
          })
        } else if (daysUntilExpiration <= 0) {
          alerts.push({
            clientName: client.clientName,
            contractName: 'Contract Term',
            endDate: client.contractEndDate,
            daysUntilExpiration,
            accountOwners: client.accountOwners || [],
            monthlyFee: client.monthlyFee,
            isExpired: true
          })
        }
      }

      // Also check individual contract files
      if (client.contracts && Array.isArray(client.contracts)) {
        client.contracts.forEach(contract => {
          if (contract.endDate) {
            const endDate = new Date(contract.endDate)
            const daysUntilExpiration = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24))

            if (daysUntilExpiration <= 15 && daysUntilExpiration > 0) {
              alerts.push({
                clientName: client.clientName,
                contractName: contract.fileName,
                endDate: contract.endDate,
                daysUntilExpiration,
                accountOwners: client.accountOwners || [],
                monthlyFee: client.monthlyFee
              })
            } else if (daysUntilExpiration <= 0) {
              alerts.push({
                clientName: client.clientName,
                contractName: contract.fileName,
                endDate: contract.endDate,
                daysUntilExpiration,
                accountOwners: client.accountOwners || [],
                monthlyFee: client.monthlyFee,
                isExpired: true
              })
            }
          }
        })
      }
    })

    return alerts.sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration)
  }

  const alerts = getUpcomingExpirations()

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: '700' }}>⏰ Contract Alerts</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', backgroundColor: 'var(--gray-50)' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Expiring Soon (15 days)</p>
          <p style={{ margin: '0', fontSize: '28px', fontWeight: '700', color: '#ff6b6b' }}>
            {alerts.filter(a => !a.isExpired).length}
          </p>
        </div>
        <div style={{ border: '1px solid var(--gray-300)', borderRadius: '6px', padding: '20px', backgroundColor: 'var(--gray-50)' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--gray-600)', fontWeight: '600' }}>Already Expired</p>
          <p style={{ margin: '0', fontSize: '28px', fontWeight: '700', color: '#dc2626' }}>
            {alerts.filter(a => a.isExpired).length}
          </p>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', backgroundColor: 'var(--gray-50)', borderRadius: '8px', border: '1px solid var(--gray-300)' }}>
          <p style={{ margin: '0', fontSize: '16px', color: 'var(--gray-600)', fontWeight: '500' }}>✓ No upcoming contract expirations</p>
          <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: 'var(--gray-600)' }}>All contracts are current</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
          {alerts.map((alert, idx) => (
            <div
              key={idx}
              style={{
                border: `2px solid ${alert.isExpired ? '#dc2626' : alert.daysUntilExpiration <= 7 ? '#ff6b6b' : '#fbbf24'}`,
                borderRadius: '6px',
                padding: '16px',
                backgroundColor: alert.isExpired ? '#fee2e2' : alert.daysUntilExpiration <= 7 ? '#fef2f2' : '#fffbeb'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', fontSize: '14px' }}>
                    {alert.clientName}
                  </p>
                  <p style={{ margin: '0', fontSize: '12px', color: 'var(--gray-600)' }}>
                    📄 {alert.contractName}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{
                    margin: '0 0 4px 0',
                    fontSize: '14px',
                    fontWeight: '700',
                    color: alert.isExpired ? '#dc2626' : alert.daysUntilExpiration <= 7 ? '#ff6b6b' : '#f59e0b'
                  }}>
                    {alert.isExpired ? 'EXPIRED' : `${alert.daysUntilExpiration} days`}
                  </p>
                  <p style={{ margin: '0', fontSize: '11px', color: 'var(--gray-600)' }}>
                    Expires: {new Date(alert.endDate).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {alert.accountOwners && alert.accountOwners.length > 0 && (
                <div style={{ backgroundColor: 'white', padding: '8px 12px', borderRadius: '4px', marginTop: '12px', borderTop: `2px solid ${alert.isExpired ? '#fca5a5' : alert.daysUntilExpiration <= 7 ? '#fecaca' : '#fcd34d'}` }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: '600', color: 'var(--gray-600)' }}>Account Owners to Alert:</p>
                  {alert.accountOwners.map((owner, oIdx) => (
                    <p key={oIdx} style={{ margin: '2px 0', fontSize: '10px', color: 'var(--gray-600)' }}>
                      • {owner.name} ({owner.email})
                    </p>
                  ))}
                </div>
              )}

              <p style={{ margin: '12px 0 0 0', fontSize: '11px', color: 'var(--gray-600)' }}>
                Monthly Revenue: <span style={{ fontWeight: '600' }}>${alert.monthlyFee?.toFixed(2) || '0.00'}</span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProfileCompletionModal({ user, onSave }) {
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError('Full name is required')
      return
    }
    setLoading(true)
    try {
      await onSave(fullName)
    } catch (err) {
      setError('Failed to save profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: '500px' }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '20px' }}>Complete Your Profile</h2>
        <p style={{ margin: '0 0 24px 0', fontSize: '14px', color: 'var(--gray-600)' }}>
          We need your full name to complete your profile. This will help the team identify you in the system.
        </p>

        <div className="form-group" style={{ marginBottom: '24px' }}>
          <label>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter your full name"
            style={{
              padding: '10px 12px',
              border: '1px solid var(--gray-300)',
              borderRadius: '6px',
              fontSize: '14px',
              width: '100%'
            }}
            autoFocus
            onKeyPress={(e) => e.key === 'Enter' && handleSave()}
          />
        </div>

        {error && (
          <p style={{ color: '#dc2626', fontSize: '14px', marginBottom: '16px' }}>
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button
            onClick={handleSave}
            disabled={loading}
            className="btn btn-primary"
            style={{
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AccountSettingsPage({ user, onUpdate }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const usersQuery = query(collection(db, 'users'), where('uid', '==', user.uid))
        const snapshot = await getDocs(usersQuery)
        if (snapshot.docs.length > 0) {
          const userData = snapshot.docs[0].data()
          setName(userData.name || '')
        }
        setLoading(false)
      } catch (error) {
        console.error('Error loading user profile:', error)
        setError('Failed to load profile')
        setLoading(false)
      }
    }
    loadUserProfile()
  }, [user])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Full name is required')
      return
    }

    setSaving(true)
    setError('')
    setSuccessMessage('')

    try {
      const usersQuery = query(collection(db, 'users'), where('uid', '==', user.uid))
      const snapshot = await getDocs(usersQuery)
      if (snapshot.docs.length > 0) {
        const userDoc = snapshot.docs[0]
        await updateDoc(doc(db, 'users', userDoc.id), {
          name: name
        })
        setSuccessMessage('Profile updated successfully')
        if (onUpdate) onUpdate()
      }
    } catch (error) {
      console.error('Error updating profile:', error)
      setError('Failed to update profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ padding: '24px', textAlign: 'center' }}>Loading...</div>
  }

  return (
    <div style={{ padding: '24px', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 24px 0', fontSize: '24px', fontWeight: '700' }}>Account Settings</h1>

        <div style={{ backgroundColor: 'white', border: '1px solid var(--gray-300)', borderRadius: '8px', padding: '24px' }}>
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label>Email</label>
            <input
              type="email"
              value={user.email}
              disabled
              style={{
                padding: '10px 12px',
                border: '1px solid var(--gray-300)',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: 'var(--gray-100)',
                color: 'var(--gray-600)',
                cursor: 'not-allowed'
              }}
            />
            <p style={{ fontSize: '12px', color: 'var(--gray-600)', margin: '4px 0 0 0' }}>Contact administrator to change email</p>
          </div>

          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label>Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              style={{
                padding: '10px 12px',
                border: '1px solid var(--gray-300)',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: '14px', marginBottom: '16px' }}>
              {error}
            </p>
          )}

          {successMessage && (
            <p style={{ color: '#16a34a', fontSize: '14px', marginBottom: '16px' }}>
              {successMessage}
            </p>
          )}

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary btn-large"
            style={{
              width: '100%',
              opacity: saving ? 0.6 : 1,
              cursor: saving ? 'not-allowed' : 'pointer'
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default App

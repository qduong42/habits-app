import { useMe } from '../useMe';

// Placeholder — achievements gallery and settings arrive in Tasks 14 and 19.
export default function Profile() {
  const me = useMe();
  return (
    <div>
      <h1 className="page-title">Profile</h1>
      <p className="placeholder">
        {me.data ? `Logged in as ${me.data.name}.` : ''} Achievements and settings will show up
        here.
      </p>
    </div>
  );
}

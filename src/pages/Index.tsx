import { useMeetingStore } from '@/store/meetingStore';
import { LobbyScreen } from '@/components/meeting/LobbyScreen';
import { ConnectingScreen } from '@/components/meeting/ConnectingScreen';
import { MeetingRoom } from '@/components/meeting/MeetingRoom';
import { MeetingSummaryModal } from '@/components/meeting/MeetingSummaryModal';
import { WaitingRoomScreen } from '@/components/meeting/WaitingRoomScreen';

const Index = () => {
  const screen = useMeetingStore((s) => s.screen);

  return (
    <>
      {screen === 'lobby' && <LobbyScreen />}
      {screen === 'waiting' && <WaitingRoomScreen />}
      {screen === 'connecting' && <ConnectingScreen />}
      {screen === 'meeting' && (
        <div className="h-screen">
          <MeetingRoom />
        </div>
      )}
      <MeetingSummaryModal />
    </>
  );
};

export default Index;

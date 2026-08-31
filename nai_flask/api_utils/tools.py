import random
import string
from datetime import datetime, timezone

def get_z_time_now():
    """
    生成Z格式的当前UTC时间 (例如: 2025-08-16T07:50:05.345Z)。

    Returns:
        str: 格式化后的ISO 8601标准时间字符串。
    """
    # 获取带有时区信息的当前UTC时间
    utc_now = datetime.now(timezone.utc)
    
    # 使用isoformat()方法生成符合要求的字符串，
    # 然后将'+00:00'替换为'Z'
    iso_string = utc_now.isoformat(timespec='milliseconds')
    
    return iso_string.replace('+00:00', 'Z')

def correlation_id_generator():
    """
    生成唯一的关联ID
    """
    characters = string.ascii_letters + string.digits
  
    random_string = ''.join(random.choice(characters) for _ in range(6))
    
    return random_string

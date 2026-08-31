// CategoryForm.js
import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  List,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  FormControlLabel,
  RadioGroup,
  Radio,
  Snackbar,
  Grid,
  Chip,
  Tooltip,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Divider,
  useMediaQuery,
  useTheme,
  InputAdornment
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  ContentCopy as CopyIcon,
  Save as SaveIcon,
  KeyboardArrowDown as ExpandMoreIcon,
  Casino as CasinoIcon,
  Send as SendIcon,
  PlaylistPlay as SequentialIcon,
  // Loop as LoopIcon, // LoopIcon 未使用，可以移除
  Check as CheckIcon,
  Close as CloseIcon,
  FormatListBulleted as ListIcon
} from '@mui/icons-material';
import { v4 as uuidv4 } from 'uuid';
import { useI18n } from '@/i18n/I18nProvider';

// 类别表单组件
const CategoryForm = ({ categories = [], onChange, onInsert, generateExample }) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null); // 用于编辑时存储原始类别对象
  const [currentCategoryForExample, setCurrentCategoryForExample] = useState(null); // 用于示例生成的当前类别对象

  // 表单状态
  const [categoryName, setCategoryName] = useState('');
  const [itemsBulkText, setItemsBulkText] = useState('');
  const [splitMethod, setSplitMethod] = useState('comma');
  const [extractCount, setExtractCount] = useState(1);
  const [weightType, setWeightType] = useState('none');
  const [fixedWeight, setFixedWeight] = useState(1);
  const [randomWeightMin, setRandomWeightMin] = useState(0);
  const [randomWeightMax, setRandomWeightMax] = useState(3);
  const [extractMode, setExtractMode] = useState('random'); 
  const [startPosition, setStartPosition] = useState(0); // 用户配置的起始位置
  const [parsedItems, setParsedItems] = useState([]);
  
  const [exampleOpen, setExampleOpen] = useState(false);
  const [currentExample, setCurrentExample] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, messageKey: '', severity: 'info' });
  
  // 打开类别对话框
  const handleOpenCategoryDialog = (category = null) => {
    if (category) {
      setEditingCategory(category); // 保存原始对象
      setCurrentCategoryForExample(category); // 初始化用于示例生成的对象
      setCategoryName(category.name);
      setExtractCount(category.extractCount || 1);
      
      if (category.weightConfig) {
        setWeightType(category.weightConfig.type || 'none');
        setFixedWeight(category.weightConfig.fixedValue || 1);
        setRandomWeightMin(category.weightConfig.randomMin || 0);
        setRandomWeightMax(category.weightConfig.randomMax || 3);
      } else {
        setWeightType('none');
        setFixedWeight(1);
        setRandomWeightMin(0);
        setRandomWeightMax(3);
      }
      
      setExtractMode(category.extractMode || 'random');
      
      // 初始化起始位置：优先从localStorage读取，其次用category对象中的，最后默认为0
      let initialStartPosition = category.startPosition || 0;
      if (category.extractMode === 'sequential') {
        const storageKey = `category_item_position_${category.id || category.name}`; // 最好使用ID
        const storedPosition = localStorage.getItem(storageKey);
        if (storedPosition !== null) {
          const parsedStoredPosition = parseInt(storedPosition, 10);
          // 只有当 localStorage 的值有效时才使用它作为 UI 的初始值
          // 否则，UI 显示的是用户上次保存的配置 (category.startPosition)
          // generateExample 会自行处理轮询的当前位置
           if (!isNaN(parsedStoredPosition)) {
             // initialStartPosition = parsedStoredPosition; // 这行注释掉，让UI显示配置的起始点
           }
        }
      }
      setStartPosition(category.startPosition || 0); // UI显示配置的起始点
      
      setItemsBulkText(category.items.join(splitMethod === 'comma' ? ', ' : '\n'));
      handleParseItems(category.items); // 直接用 category.items 解析
    } else {
      setEditingCategory(null);
      setCurrentCategoryForExample(null);
      setCategoryName('');
      setItemsBulkText('');
      setSplitMethod('comma');
      setExtractCount(1);
      setWeightType('none');
      setFixedWeight(1);
      setRandomWeightMin(0);
      setRandomWeightMax(3);
      setExtractMode('random');
      setStartPosition(0);
      setParsedItems([]);
    }
    setCategoryDialogOpen(true);
  };

  // 关闭类别对话框
  const handleCloseCategoryDialog = () => {
    setCategoryDialogOpen(false);
    setCurrentCategoryForExample(null); // 清理
  };
  
  // 解析词条为标签或列表
  const handleParseItems = (itemsArray = null) => {
    let itemsToParse = itemsArray;
    
    if (!itemsToParse) { // 如果没有直接传入数组，则从批量文本解析
      if (!itemsBulkText.trim()) {
        setParsedItems([]);
        return;
      }
      if (splitMethod === 'comma') {
        itemsToParse = itemsBulkText.split(/[,，]/).map(item => item.trim()).filter(Boolean);
      } else if (splitMethod === 'line') {
        itemsToParse = itemsBulkText.split(/\n/).map(item => item.trim()).filter(Boolean);
      }
    }
    setParsedItems(itemsToParse || []);
  };
  
  // 移除单个标签
  const handleRemoveItem = (index) => {
    const newItems = [...parsedItems];
    newItems.splice(index, 1);
    setParsedItems(newItems);
    const newBulkText = newItems.join(splitMethod === 'comma' ? ', ' : '\n');
    setItemsBulkText(newBulkText);
  };

  // 保存类别
  const handleSaveCategory = () => {
    if (!categoryName.trim()) {
      alert(t('painting.tools.randomPrompt.category.errors.nameRequired'));
      return;
    }
    
    const weightConfig = {
      type: weightType,
      fixedValue: parseFloat(fixedWeight),
      randomMin: parseFloat(randomWeightMin),
      randomMax: parseFloat(randomWeightMax)
    };
    
    const categoryData = {
      name: categoryName.trim(),
      items: parsedItems,
      extractCount: parseInt(extractCount, 10) || 1,
      weightConfig,
      extractMode, 
      startPosition: parseInt(startPosition, 10) || 0 // 保存用户配置的起始位置
    };

    if (editingCategory) {
      const updatedCategories = categories.map(cat => 
        cat.id === editingCategory.id ? { ...cat, ...categoryData } : cat
      );
      onChange(updatedCategories);
    } else {
      const newCategory = { id: uuidv4(), ...categoryData };
      onChange([...categories, newCategory]);
    }
    
    // 如果是顺序轮询模式，并且用户在UI上修改了起始位置，可以考虑更新localStorage中的“配置起始点”
    // 但更推荐让 generateExample 内部的轮询逻辑去动态管理实际的当前轮询位置。
    // 此处保存的 startPosition 是用户希望的“默认起始点”。
    // if (extractMode === 'sequential') {
    //   const catId = editingCategory ? editingCategory.id : categories.find(c => c.name === categoryName.trim())?.id;
    //   if (catId) {
    //      const storageKey = `category_item_position_${catId}`;
           // localStorage.setItem(storageKey, categoryData.startPosition.toString()); // 保存配置的起始点
    //   }
    // }
    
    handleCloseCategoryDialog();
  };

  // 删除类别
  const handleDeleteCategory = (categoryId) => {
    // 考虑使用更友好的确认对话框替代 window.confirm
    if (window.confirm(t('painting.tools.randomPrompt.category.confirmDelete'))) {
      const updatedCategories = categories.filter(cat => cat.id !== categoryId);
      onChange(updatedCategories);
    }
  };

  // 显示示例
  const handleShowExample = (category) => {
     // 确保传递给 generateExample 的是最新状态的 category 对象
    const latestCategory = categories.find(c => c.id === category.id);
    if (latestCategory) {
        setCurrentCategoryForExample(latestCategory); // 用于“重新生成”时获取最新状态
        const example = generateExample(latestCategory, 'category'); // 显式传递 type
        setCurrentExample(example);
    } else {
        // Fallback，理论上不应发生
        setCurrentCategoryForExample(category);
        const example = generateExample(category, 'category');
        setCurrentExample(example);
    }
    setExampleOpen(true);
  };

  // 关闭示例对话框
  const handleCloseExample = () => {
    setExampleOpen(false);
  };
  
  // 渲染标签列表
  const renderParsedItems = () => {
    if (parsedItems.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary">
          {t('painting.tools.randomPrompt.category.noParsedItems')}
        </Typography>
      );
    }
    
    return (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {parsedItems.map((item, index) => (
          splitMethod === 'comma' ? (
            <Chip 
              key={index} 
              label={item} 
              variant="outlined" 
              size="small"
              onDelete={() => handleRemoveItem(index)}
              sx={{ maxWidth: '100%', overflow: 'hidden' }}
            />
          ) : (
            <Box key={index} sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              width: '100%',
              p: 0.5,
              borderRadius: 1,
              '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.05)' }
            }}>
              <Typography variant="body2" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {index + 1}. {item}
              </Typography>
              <IconButton 
                aria-label={t('painting.tools.randomPrompt.category.removeItem')}
                size="small" 
                onClick={() => handleRemoveItem(index)}
                sx={{ opacity: 0.6, '&:hover': { opacity: 1 } }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          )
        ))}
      </Box>
    );
  };

  return (
    <Box sx={{ p: isMobile ? 2 : 3 }}>
      {/* 类别列表 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Typography variant="h6" sx={{ mb: isMobile ? 1 : 0 }}>{t('painting.tools.randomPrompt.category.listTitle')}</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => handleOpenCategoryDialog()}
          size={isMobile ? "small" : "medium"}
          fullWidth={isMobile}
        >
          {t('painting.tools.randomPrompt.category.add')}
        </Button>
      </Box>
      
      {categories.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('painting.tools.randomPrompt.category.empty')}
        </Alert>
      ) : (
        <List sx={{ mb: 2, p:0 }}> {/* 移除List的默认padding */}
          {categories.map((category) => (
            <Accordion key={category.id} sx={{ mb: 1 }} TransitionProps={{ unmountOnExit: true }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                  <Typography variant="subtitle1" sx={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile? '100%' : '200px'}} title={category.name}>
                    {category.name}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: isMobile ? 1 : 0, justifyContent: isMobile ? 'flex-start' : 'flex-end' }}>
                    <Chip 
                      size="small" 
                      label={t('painting.tools.randomPrompt.category.itemCount', { count: category.items.length })}
                      sx={{ mr: 0.5 }} 
                    />
                    <Chip 
                      size="small" 
                      color="primary" 
                      label={t('painting.tools.randomPrompt.category.extractCountShort', { count: category.extractCount })}
                      sx={{ mr: 0.5 }} 
                    />
                    <Chip 
                      size="small" 
                      color="secondary"
                      icon={category.extractMode === 'random' ? <CasinoIcon fontSize="small"/> : <SequentialIcon fontSize="small"/>}
                      label={category.extractMode === 'random'
                        ? t('painting.tools.randomPrompt.modes.randomShort')
                        : t('painting.tools.randomPrompt.modes.sequentialShort')}
                      sx={{ mr: 0.5 }}
                    />
                    <Chip 
                      size="small" 
                      color={!category.weightConfig || category.weightConfig.type === 'none' ? 'default' : 'info'}
                      label={
                        !category.weightConfig || category.weightConfig.type === 'none'
                          ? t('painting.tools.randomPrompt.weights.none')
                          : category.weightConfig.type === 'fixed'
                            ? t('painting.tools.randomPrompt.weights.fixedShort', { value: category.weightConfig.fixedValue })
                            : t('painting.tools.randomPrompt.weights.randomShort', {
                              min: category.weightConfig.randomMin,
                              max: category.weightConfig.randomMax,
                            })
                      }
                    />
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  <Typography variant="subtitle2" gutterBottom>{t('painting.tools.randomPrompt.category.items')}:</Typography>
                  <Box sx={{ 
                    p: 1, 
                    bgcolor: 'rgba(0,0,0,0.03)', 
                    borderRadius: 1, 
                    mb: 2,
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {category.items.map((item, index) => (
                        <Chip 
                          key={index} 
                          label={item} 
                          variant="outlined" 
                          size="small" 
                        />
                      ))}
                      {category.items.length === 0 && (
                        <Typography variant="body2" color="text.secondary">
                          {t('painting.tools.randomPrompt.category.noItems')}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? 1 : 0
                  }}>
                    <Box sx={{ mb: isMobile ? 1 : 0, display: 'flex', gap: 1 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => handleOpenCategoryDialog(category)}
                      >
                        {t('painting.tools.common.edit')}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleDeleteCategory(category.id)}
                      >
                        {t('painting.tools.common.delete')}
                      </Button>
                    </Box>
                    <Box sx={{display: 'flex', gap: 1, flexWrap:'wrap'}}>
                      <Tooltip title={t('painting.tools.randomPrompt.copySyntaxTooltip')} arrow>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<CopyIcon />}
                          onClick={() => {
                            const syntax = `<ran_id="${category.name}"/>`;
                            navigator.clipboard.writeText(syntax);
                            setSnackbar({
                              open: true,
                              messageKey: 'painting.tools.randomPrompt.messages.syntaxCopied',
                              severity: 'success'
                            });
                          }}
                        >
                          {t('painting.tools.randomPrompt.copySyntax')}
                        </Button>
                      </Tooltip>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CasinoIcon />}
                        onClick={() => handleShowExample(category)}
                      >
                        {t('painting.tools.randomPrompt.example')}
                      </Button>
                      <Button
                        variant="contained"
                        size="small"
                        color="primary"
                        startIcon={<SendIcon />}
                        onClick={() => onInsert(category)}
                      >
                        {t('painting.tools.randomPrompt.insert')}
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </List>
      )}
      
      <Dialog 
        open={categoryDialogOpen} 
        onClose={handleCloseCategoryDialog}
        fullWidth
        maxWidth="md"
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center',
          py: 1.5 // 调整DialogTitle的上下padding
        }}>
          <Typography variant="h6">
            {editingCategory
              ? t('painting.tools.randomPrompt.category.editTitle')
              : t('painting.tools.randomPrompt.category.createTitle')}
          </Typography>
          {isMobile && (
            <IconButton aria-label={t('painting.tools.common.close')} onClick={handleCloseCategoryDialog} size="small">
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={isMobile ? 2 : 3} sx={{ mt: 0 }}>
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>{t('painting.tools.randomPrompt.basicInfo')}</Typography>
              <TextField
                label={t('painting.tools.randomPrompt.category.name')}
                fullWidth
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                margin="dense" // 改为dense
                required
                placeholder={t('painting.tools.randomPrompt.category.namePlaceholder')}
              />
              
              <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>{t('painting.tools.randomPrompt.extractMode')}</Typography>
              <FormControl component="fieldset" margin="dense">
                <RadioGroup
                  value={extractMode}
                  onChange={(e) => setExtractMode(e.target.value)}
                  row
                >
                  <FormControlLabel 
                    value="random" 
                    control={<Radio size="small"/>} 
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <CasinoIcon fontSize="small" sx={{ mr: 0.5 }} />
                        <span>{t('painting.tools.randomPrompt.modes.random')}</span>
                      </Box>
                    }
                  />
                  <FormControlLabel 
                    value="sequential" 
                    control={<Radio size="small"/>} 
                    label={
                      <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <SequentialIcon fontSize="small" sx={{ mr: 0.5 }} />
                        <span>{t('painting.tools.randomPrompt.modes.sequential')}</span>
                      </Box>
                    }
                  />
                </RadioGroup>
              </FormControl>
              
              <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                <TextField
                  label={t('painting.tools.randomPrompt.extractCount')}
                  type="number"
                  value={extractCount}
                  onChange={(e) => setExtractCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  margin="dense" // 改为dense
                  inputProps={{ min: 1, max: parsedItems.length > 0 ? parsedItems.length : 1 }}
                  sx={{ width: '50%' }}
                  helperText={t('painting.tools.randomPrompt.maximumCount', { count: parsedItems.length })}
                />
                
                {extractMode === 'sequential' && (
                  <TextField
                    label={t('painting.tools.randomPrompt.startPosition')}
                    type="number"
                    value={startPosition}
                    onChange={(e) => setStartPosition(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    margin="dense" // 改为dense
                    inputProps={{ min: 0 }}
                    helperText={t('painting.tools.randomPrompt.startPositionHelp')}
                    sx={{ width: '50%' }}
                  />
                )}
              </Box>
              
              <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>{t('painting.tools.randomPrompt.weights.title')}</Typography>
              <FormControl component="fieldset" margin="dense">
                <RadioGroup
                  value={weightType}
                  onChange={(e) => setWeightType(e.target.value)}
                >
                  <FormControlLabel value="none" control={<Radio size="small"/>} label={t('painting.tools.randomPrompt.weights.none')} />
                  <FormControlLabel value="fixed" control={<Radio size="small"/>} label={t('painting.tools.randomPrompt.weights.fixed')} />
                  {weightType === 'fixed' && (
                    <TextField
                      label={t('painting.tools.randomPrompt.weights.value')} type="number" value={fixedWeight}
                      onChange={(e) => setFixedWeight(e.target.value)}
                      margin="dense" inputProps={{ min: 0, step: 0.1 }}
                      sx={{ ml: 4, width: '150px' }} // 调小宽度
                    />
                  )}
                  <FormControlLabel value="random" control={<Radio size="small"/>} label={t('painting.tools.randomPrompt.weights.random')} />
                  {weightType === 'random' && (
                    <Box sx={{ ml: 4, display: 'flex', gap: 2, mt: 0.5 }}>
                      <TextField
                        label={t('painting.tools.randomPrompt.minimum')} type="number" value={randomWeightMin}
                        onChange={(e) => setRandomWeightMin(e.target.value)}
                        margin="dense" inputProps={{ min: 0, step: 0.1 }}
                        sx={{width: '100px'}}
                      />
                      <TextField
                        label={t('painting.tools.randomPrompt.maximum')} type="number" value={randomWeightMax}
                        onChange={(e) => setRandomWeightMax(e.target.value)}
                        margin="dense" inputProps={{ min: 0, step: 0.1 }}
                        sx={{width: '100px'}}
                      />
                    </Box>
                  )}
                </RadioGroup>
              </FormControl>
            </Grid>
            
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>{t('painting.tools.randomPrompt.category.itemManagement')}</Typography>
              <FormControl component="fieldset" sx={{ mb: 1 }} margin="dense">
                <RadioGroup
                  value={splitMethod}
                  onChange={(e) => {
                    setSplitMethod(e.target.value);
                    if (parsedItems.length > 0) {
                      setItemsBulkText(parsedItems.join(e.target.value === 'comma' ? ', ' : '\n'));
                    }
                  }}
                  row
                >
                  <FormControlLabel value="comma" control={<Radio size="small"/>} label={t('painting.tools.randomPrompt.category.splitComma')} />
                  <FormControlLabel value="line" control={<Radio size="small"/>} label={t('painting.tools.randomPrompt.category.splitLine')} />
                </RadioGroup>
              </FormControl>
              
              <TextField
                label={t('painting.tools.randomPrompt.category.bulkItems')}
                multiline
                rows={5}
                fullWidth
                value={itemsBulkText}
                onChange={(e) => setItemsBulkText(e.target.value)}
                placeholder={splitMethod === 'comma' ? 
                  t('painting.tools.randomPrompt.category.commaPlaceholder') :
                  t('painting.tools.randomPrompt.category.linePlaceholder')}
                margin="dense" // 改为dense
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end" sx={{position:'absolute', right: 8, top: 12}}>
                      <Tooltip title={t('painting.tools.randomPrompt.category.parseItems')}>
                        <IconButton aria-label={t('painting.tools.randomPrompt.category.parseItems')} onClick={() => handleParseItems()} color="primary" size="small">
                          <CheckIcon />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  )
                }}
              />
              
              <Button
                variant="outlined"
                startIcon={<CheckIcon />}
                onClick={() => handleParseItems()} // 确保调用的是无参数版本以从文本框解析
                sx={{ mt: 1, mb: 1 }}
                fullWidth
                size="small"
              >
                {t('painting.tools.randomPrompt.category.parseItems')}
              </Button>
              
              <Paper variant="outlined" sx={{ p: 1.5, maxHeight: '200px', overflowY: 'auto', minHeight: '80px' }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t('painting.tools.randomPrompt.category.parsedItems')} ({t('painting.tools.randomPrompt.category.itemCount', { count: parsedItems.length })}):
                </Typography>
                {renderParsedItems()}
              </Paper>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseCategoryDialog}>{t('painting.tools.common.cancel')}</Button>
          <Button 
            onClick={handleSaveCategory} 
            variant="contained" 
            color="primary"
            startIcon={<SaveIcon />}
          >
            {t('painting.tools.common.save')}
          </Button>
        </DialogActions>
      </Dialog>
      
      <Dialog
        open={exampleOpen}
        onClose={handleCloseExample}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center' 
        }}>
          <Typography>{t('painting.tools.randomPrompt.exampleTitle')}</Typography>
          {isMobile && (
            <IconButton aria-label={t('painting.tools.common.close')} onClick={handleCloseExample} size="small">
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('painting.tools.randomPrompt.exampleHelp')}
          </Alert>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              backgroundColor: 'rgba(0, 0, 0, 0.03)',
              borderRadius: 2,
              fontFamily: '"Roboto Mono", monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              minHeight: '100px'
            }}
          >
            {currentExample || t('painting.tools.randomPrompt.category.emptyExample')}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button 
            startIcon={<CasinoIcon />}
            onClick={() => {
              // 使用 currentCategoryForExample 来确保使用的是打开示例时的那个类别对象（或其最新版本）
              if (currentCategoryForExample) {
                 // 为了确保拿到最新的配置（如果用户在打开示例后又编辑了但未保存），我们从 categories 数组中再找一次
                const latestVersionOfExampleCategory = categories.find(c => c.id === currentCategoryForExample.id);
                const categoryToGenerate = latestVersionOfExampleCategory || currentCategoryForExample;
                setCurrentExample(generateExample(categoryToGenerate, 'category'));
              } else if (editingCategory) { // Fallback if currentCategoryForExample is somehow null
                 const latestVersionOfEditingCategory = categories.find(c => c.id === editingCategory.id);
                 const categoryToGenerate = latestVersionOfEditingCategory || editingCategory;
                 setCurrentExample(generateExample(categoryToGenerate, 'category'));
              }
            }}
          >
            {t('painting.tools.randomPrompt.regenerate')}
          </Button>
          <Button onClick={handleCloseExample}>{t('painting.tools.common.close')}</Button>
        </DialogActions>
      </Dialog>
      
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.severity}
          sx={{ width: '100%' }}
          variant="filled" // 使用filled Alert 以便更醒目
        >
          {snackbar.messageKey ? t(snackbar.messageKey) : ''}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CategoryForm;

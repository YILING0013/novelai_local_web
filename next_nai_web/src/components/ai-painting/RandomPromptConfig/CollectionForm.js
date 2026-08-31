// CollectionForm.js
import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  List,
  ListItem,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  Tooltip,
  Switch,
  Snackbar,
  Grid,
  Chip,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Checkbox,
  IconButton,
  Divider,
  useMediaQuery,
  useTheme,
  RadioGroup, // 新增
  Radio // 新增
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
  Shuffle as ShuffleIcon,
  Close as CloseIcon,
  PlaylistPlay as SequentialIcon // 新增
} from '@mui/icons-material';
import { v4 as uuidv4 } from 'uuid';
import { useI18n } from '@/i18n/I18nProvider';

// 集合表单组件
const CollectionForm = ({ collections = [], categories = [], onChange, onInsert, generateExample }) => {
  const theme = useTheme();
  const { t } = useI18n();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState(null);
  const [collectionName, setCollectionName] = useState('');
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [randomOrder, setRandomOrder] = useState(true); // 集合内类别处理后的词条是否随机排序
  const [useFixedWeight, setUseFixedWeight] = useState(false);
  const [fixedWeight, setFixedWeight] = useState(1);
  
  // 新增：从集合中抽取N个类别的相关状态
  const [extractNCategories, setExtractNCategories] = useState(false); // 是否启用抽取N个类别
  const [numToExtract, setNumToExtract] = useState(1); // 要抽取的类别数量
  const [categoryExtractMode, setCategoryExtractMode] = useState('random'); // 集合中类别的抽取模式: 'random' 或 'sequential'
  const [categoryStartPosition, setCategoryStartPosition] = useState(0); // 集合中类别轮询的起始位置

  const [exampleOpen, setExampleOpen] = useState(false);
  const [currentExample, setCurrentExample] = useState('');
  const [snackbar, setSnackbar] = useState({ open: false, messageKey: '', severity: 'info' });
  const [currentCollectionForExample, setCurrentCollectionForExample] = useState(null); // 用于示例生成的当前集合对象

  // 打开集合对话框
  const handleOpenCollectionDialog = (collection = null) => {
    if (collection) {
      setEditingCollection(collection);
      setCurrentCollectionForExample(collection); // 初始化用于示例生成的对象
      setCollectionName(collection.name);
      setRandomOrder(collection.randomOrder !== false);
      setUseFixedWeight(collection.useFixedWeight || false);
      setFixedWeight(collection.fixedWeight || 1);
      
      // 设置已选择的类别
      if (collection.categoryRefs && Array.isArray(collection.categoryRefs)) {
        setSelectedCategories(collection.categoryRefs);
      } else {
        setSelectedCategories([]);
      }

      // 初始化抽取N个类别的配置
      setExtractNCategories(collection.extractNCategories || false);
      setNumToExtract(collection.numToExtract || 1);
      setCategoryExtractMode(collection.categoryExtractMode || 'random');
      
      let initialCategoryStartPosition = collection.categoryStartPosition || 0;
      if (collection.categoryExtractMode === 'sequential') {
        const storageKey = `collection_category_position_${collection.id || collection.name}`;
        const storedPosition = localStorage.getItem(storageKey);
        if (storedPosition !== null) {
          initialCategoryStartPosition = parseInt(storedPosition, 10);
          if (isNaN(initialCategoryStartPosition)) initialCategoryStartPosition = collection.categoryStartPosition || 0; // 防止NaN
        }
      }
      setCategoryStartPosition(initialCategoryStartPosition);

    } else {
      setEditingCollection(null);
      setCurrentCollectionForExample(null);
      setCollectionName('');
      setRandomOrder(true);
      setUseFixedWeight(false);
      setFixedWeight(1);
      setSelectedCategories([]);
      // 重置抽取N个类别的配置
      setExtractNCategories(false);
      setNumToExtract(1);
      setCategoryExtractMode('random');
      setCategoryStartPosition(0);
    }
    setCollectionDialogOpen(true);
  };

  // 关闭集合对话框
  const handleCloseCollectionDialog = () => {
    setCollectionDialogOpen(false);
    setCurrentCollectionForExample(null); // 清理
  };

  // 保存集合
  const handleSaveCollection = () => {
    if (!collectionName.trim()) {
      alert(t('painting.tools.randomPrompt.collection.errors.nameRequired'));
      return;
    }
    
    if (selectedCategories.length === 0) {
      alert(t('painting.tools.randomPrompt.collection.errors.categoryRequired'));
      return;
    }
    
    const collectionData = {
      name: collectionName.trim(),
      categoryRefs: [...selectedCategories],
      randomOrder,
      useFixedWeight,
      fixedWeight: parseFloat(fixedWeight),
      // 新增抽取N个类别的配置
      extractNCategories,
      numToExtract: parseInt(numToExtract, 10) || 1,
      categoryExtractMode,
      categoryStartPosition: parseInt(categoryStartPosition, 10) || 0,
    };

    if (editingCollection) {
      // 更新现有集合
      const updatedCollections = collections.map(coll => {
        if (coll.id === editingCollection.id) {
          return {
            ...coll,
            ...collectionData
          };
        }
        return coll;
      });
      onChange(updatedCollections);
    } else {
      // 创建新集合
      const newCollection = {
        id: uuidv4(),
        ...collectionData
      };
      onChange([...collections, newCollection]);
    }
    
    // 如果集合类别抽取模式是轮询，保存其起始位置 (注意：实际轮询位置由 RandomPromptConfig 中的 generateExample 更新)
    // 这里保存的是用户配置的“起始点”，如果用户修改了它。
    // 真正的动态轮询位置由 generateExample 在生成时管理。
    if (categoryExtractMode === 'sequential') {
        const collectionId = editingCollection ? editingCollection.id : collections.find(c => c.name === collectionName.trim())?.id; // 需要获取到ID
        if (collectionId) { // 确保有ID
             const storageKey = `collection_category_position_${collectionId}`;
             // 只有当用户明确在UI中修改并保存时，才更新localStorage中的“配置起始点”
             // 否则，让generateExample去管理动态的当前轮询点
             // localStorage.setItem(storageKey, categoryStartPosition.toString());
        }
    }
    
    handleCloseCollectionDialog();
  };

  // 删除集合
  const handleDeleteCollection = (collectionId) => {
    if (window.confirm(t('painting.tools.randomPrompt.collection.confirmDelete'))) {
      const updatedCollections = collections.filter(coll => coll.id !== collectionId);
      onChange(updatedCollections);
    }
  };

  // 处理类别选择
  const handleCategorySelect = (categoryId) => {
    const index = selectedCategories.findIndex(item => item.categoryId === categoryId);
    if (index >= 0) {
      const updatedCategories = [...selectedCategories];
      updatedCategories.splice(index, 1);
      setSelectedCategories(updatedCategories);
    } else {
      setSelectedCategories([...selectedCategories, { categoryId }]);
    }
  };

  // 显示示例
  const handleShowExample = (collection) => {
    // 更新用于生成示例的集合对象，确保它是最新的
    const latestCollection = collections.find(c => c.id === collection.id);
    if (latestCollection) {
        setCurrentCollectionForExample(latestCollection); // 确保传递的是最新的数据
        const example = generateExample(latestCollection, 'collection'); // 显式传递 type
        setCurrentExample(example);
    } else {
        // 如果在列表中找不到（不太可能发生），使用传入的 collection
        setCurrentCollectionForExample(collection);
        const example = generateExample(collection, 'collection');
        setCurrentExample(example);
    }
    setExampleOpen(true);
  };

  // 关闭示例对话框
  const handleCloseExample = () => {
    setExampleOpen(false);
  };

  // 获取类别名称
  const getCategoryName = (categoryId) => {
    const category = categories.find(cat => cat.id === categoryId);
    return category ? category.name : t('painting.tools.randomPrompt.collection.unknownCategory');
  };

  // 检查类别是否已选择
  const isCategorySelected = (categoryId) => {
    return selectedCategories.some(item => item.categoryId === categoryId);
  };

  return (
    <Box sx={{ p: isMobile ? 2 : 3 }}>
      {/* 集合列表 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
        <Typography variant="h6" sx={{ mb: isMobile ? 1 : 0 }}>{t('painting.tools.randomPrompt.collection.listTitle')}</Typography>
        <Button
          variant="contained"
          color="primary"
          startIcon={<AddIcon />}
          onClick={() => handleOpenCollectionDialog()}
          disabled={categories.length === 0}
          size={isMobile ? "small" : "medium"}
          fullWidth={isMobile}
        >
          {t('painting.tools.randomPrompt.collection.add')}
        </Button>
      </Box>
      
      {categories.length === 0 ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('painting.tools.randomPrompt.collection.categoryFirst')}
        </Alert>
      ) : collections.length === 0 ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('painting.tools.randomPrompt.collection.empty')}
        </Alert>
      ) : (
        <List sx={{ mb: 2 }}>
          {collections.map((collection) => (
            <Accordion key={collection.id} sx={{ mb: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
                  <Typography variant="subtitle1">{collection.name}</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: isMobile ? 1 : 0 }}>
                    <Chip 
                      size="small" 
                      label={t('painting.tools.randomPrompt.collection.categoryCount', { count: collection.categoryRefs?.length || 0 })}
                      sx={{ mr: 1 }} 
                    />
                    {collection.extractNCategories ? (
                      <>
                        <Chip
                          size="small"
                          color="info"
                          label={t('painting.tools.randomPrompt.collection.extractCategoryCount', { count: collection.numToExtract })}
                          sx={{ mr: 1 }}
                        />
                        <Chip
                          size="small"
                          color={collection.categoryExtractMode === 'random' ? "success" : "warning"}
                          icon={collection.categoryExtractMode === 'random' ? <CasinoIcon /> : <SequentialIcon />}
                          label={collection.categoryExtractMode === 'random'
                            ? t('painting.tools.randomPrompt.collection.randomCategoriesShort')
                            : t('painting.tools.randomPrompt.collection.sequentialCategoriesShort')}
                          sx={{ mr: 1 }}
                        />
                      </>
                    ) : (
                       <Chip 
                        size="small" 
                        label={t('painting.tools.randomPrompt.collection.processAll')}
                        sx={{ mr: 1 }} 
                      />
                    )}
                    <Chip 
                      size="small" 
                      color={collection.randomOrder ? 'primary' : 'default'}
                      icon={<ShuffleIcon />}
                      label={t('painting.tools.randomPrompt.collection.shuffleItems')}
                      sx={{ mr: 1 }}
                    />
                    {collection.useFixedWeight && (
                      <Chip 
                        size="small" 
                        color="secondary"
                        label={t('painting.tools.randomPrompt.collection.fixedWeightValue', { value: collection.fixedWeight })}
                      />
                    )}
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box>
                  {/* 类别列表 */}
                  <Typography variant="subtitle2" gutterBottom>{t('painting.tools.randomPrompt.collection.includedCategories')}:</Typography>
                  <Box sx={{ 
                    p: 1, 
                    bgcolor: 'background.paper', 
                    borderRadius: 1, 
                    mb: 2,
                    maxHeight: '150px',
                    overflowY: 'auto'
                  }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {collection.categoryRefs?.map((ref, index) => {
                        const categoryName = getCategoryName(ref.categoryId);
                        return (
                          <Chip 
                            key={index} 
                            label={categoryName} 
                            variant="outlined" 
                            color="primary"
                            size="small" 
                          />
                        );
                      })}
                      {(!collection.categoryRefs || collection.categoryRefs.length === 0) && ( // 修复条件
                        <Typography variant="body2" color="text.secondary">
                          {t('painting.tools.randomPrompt.collection.noCategories')}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  
                  {/* 操作按钮 */}
                  <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? 1 : 0
                  }}>
                    <Box sx={{ mb: isMobile ? 1 : 0 }}>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => handleOpenCollectionDialog(collection)}
                        sx={{ mr: 1 }}
                      >
                        {t('painting.tools.common.edit')}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleDeleteCollection(collection.id)}
                      >
                        {t('painting.tools.common.delete')}
                      </Button>
                    </Box>
                    <Box>
                      <Tooltip title={t('painting.tools.randomPrompt.copySyntaxTooltip')} arrow>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<CopyIcon />}
                          onClick={() => {
                            const syntax = `<ran_sorting_id="${collection.name}"/>`;
                            navigator.clipboard.writeText(syntax);
                            setSnackbar({
                              open: true,
                              messageKey: 'painting.tools.randomPrompt.messages.syntaxCopied',
                              severity: 'success'
                            });
                          }}
                          sx={{ mr: 1 }}
                        >
                          {t('painting.tools.randomPrompt.copySyntax')}
                        </Button>
                      </Tooltip>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<CasinoIcon />}
                        onClick={() => handleShowExample(collection)}
                        sx={{ mr: 1 }}
                      >
                        {t('painting.tools.randomPrompt.example')}
                      </Button>
                      <Button
                        variant="contained"
                        size="small"
                        color="primary"
                        startIcon={<SendIcon />}
                        onClick={() => onInsert(collection)}
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
      
      {/* 集合编辑对话框 */}
      <Dialog 
        open={collectionDialogOpen} 
        onClose={handleCloseCollectionDialog}
        fullWidth
        maxWidth="md"
        fullScreen={isMobile}
      >
        <DialogTitle sx={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          alignItems: 'center' 
        }}>
          <Typography variant="h6">
            {editingCollection
              ? t('painting.tools.randomPrompt.collection.editTitle')
              : t('painting.tools.randomPrompt.collection.createTitle')}
          </Typography>
          {isMobile && (
            <IconButton aria-label={t('painting.tools.common.close')} onClick={handleCloseCollectionDialog} size="small">
              <CloseIcon />
            </IconButton>
          )}
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={isMobile ? 2 : 3} sx={{ mt: 0 }}>
            {/* 基本信息 */}
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>{t('painting.tools.randomPrompt.basicSettings')}</Typography>
              <TextField
                label={t('painting.tools.randomPrompt.collection.name')}
                fullWidth
                value={collectionName}
                onChange={(e) => setCollectionName(e.target.value)}
                margin="normal"
                required
                placeholder={t('painting.tools.randomPrompt.collection.namePlaceholder')}
              />
              
              <FormControlLabel
                control={
                  <Switch
                    checked={randomOrder}
                    onChange={(e) => setRandomOrder(e.target.checked)}
                    color="primary"
                  />
                }
                label={t('painting.tools.randomPrompt.collection.enableShuffle')}
                sx={{ mt: 2, display: 'block' }}
              />
              
              <FormControlLabel
                control={
                  <Switch
                    checked={useFixedWeight}
                    onChange={(e) => setUseFixedWeight(e.target.checked)}
                    color="secondary"
                  />
                }
                label={t('painting.tools.randomPrompt.collection.useFixedWeight')}
                sx={{ mt: 1, display: 'block' }}
              />
              
              {useFixedWeight && (
                <TextField
                  label={t('painting.tools.randomPrompt.weights.value')}
                  type="number"
                  value={fixedWeight}
                  onChange={(e) => setFixedWeight(e.target.value)}
                  margin="normal"
                  inputProps={{ min: 0, step: 0.1 }}
                  sx={{ width: '200px' }}
                  helperText={t('painting.tools.randomPrompt.collection.fixedWeightHelp')}
                />
              )}

              {/* 新增：抽取N个类别的配置 */}
              <Typography variant="subtitle1" gutterBottom sx={{ mt: 3 }}>{t('painting.tools.randomPrompt.collection.extractionSettings')}</Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={extractNCategories}
                    onChange={(e) => setExtractNCategories(e.target.checked)}
                    color="info"
                  />
                }
                label={t('painting.tools.randomPrompt.collection.extractSome')}
                sx={{ display: 'block' }}
              />

              {extractNCategories && (
                <>
                  <RadioGroup
                    value={categoryExtractMode}
                    onChange={(e) => setCategoryExtractMode(e.target.value)}
                    row
                    sx={{ mt: 1 }}
                  >
                    <FormControlLabel 
                      value="random" 
                      control={<Radio />} 
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <CasinoIcon fontSize="small" sx={{ mr: 0.5 }} />
                          <span>{t('painting.tools.randomPrompt.collection.randomCategories')}</span>
                        </Box>
                      }
                    />
                    <FormControlLabel 
                      value="sequential" 
                      control={<Radio />} 
                      label={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <SequentialIcon fontSize="small" sx={{ mr: 0.5 }} />
                          <span>{t('painting.tools.randomPrompt.collection.sequentialCategories')}</span>
                        </Box>
                      }
                    />
                  </RadioGroup>

                  <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                    <TextField
                      label={t('painting.tools.randomPrompt.collection.extractCount')}
                      type="number"
                      value={numToExtract}
                      onChange={(e) => setNumToExtract(Math.max(1, parseInt(e.target.value,10) || 1))}
                      margin="normal"
                      inputProps={{ min: 1, max: selectedCategories.length > 0 ? selectedCategories.length : 1 }}
                      sx={{ width: '50%' }}
                      helperText={t('painting.tools.randomPrompt.maximumCount', { count: selectedCategories.length })}
                    />
                    {categoryExtractMode === 'sequential' && (
                      <TextField
                        label={t('painting.tools.randomPrompt.collection.startPosition')}
                        type="number"
                        value={categoryStartPosition}
                        onChange={(e) => setCategoryStartPosition(Math.max(0, parseInt(e.target.value, 10) || 0))}
                        margin="normal"
                        inputProps={{ min: 0 }}
                        helperText={t('painting.tools.randomPrompt.collection.startPositionHelp')}
                        sx={{ width: '50%' }}
                      />
                    )}
                  </Box>
                </>
              )}
              
              <Alert severity="info" sx={{ mt: 2 }}>
                <Typography variant="body2">
                  {t('painting.tools.randomPrompt.collection.settingsHelp')}
                </Typography>
              </Alert>
            </Grid>
            
            {/* 类别选择 */}
            <Grid item xs={12} md={6}>
              <Typography variant="subtitle1" gutterBottom>{t('painting.tools.randomPrompt.collection.selectCategories', { count: selectedCategories.length })}</Typography>
              
              {categories.length === 0 ? (
                <Alert severity="warning">
                  {t('painting.tools.randomPrompt.collection.createCategoryFirst')}
                </Alert>
              ) : (
                <>
                  <Paper 
                    variant="outlined" 
                    sx={{ 
                      p: 2, 
                      maxHeight: isMobile ? '200px' : '300px', 
                      overflowY: 'auto',
                      border: '1px solid rgba(0, 0, 0, 0.12)',
                      borderRadius: 1
                    }}
                  >
                    <List dense sx={{ p: 0 }}>
                      {categories.map((category) => (
                        <ListItem 
                          key={category.id}
                          dense
                          button // 保持 button 样式，但点击事件由 Checkbox 和 ListItemText 区域处理
                          onClick={() => handleCategorySelect(category.id)} // 允许点击整行选择
                          sx={{
                            borderRadius: 1,
                            backgroundColor: isCategorySelected(category.id) ? 'rgba(124, 77, 255, 0.08)' : 'transparent',
                            mb: 0.5,
                            pr: 1, // 减少右边距，为Checkbox留出空间
                          }}
                        >
                          <Checkbox
                            edge="start"
                            checked={isCategorySelected(category.id)}
                            // onClick={(e) => { // 阻止事件冒泡，如果只想通过Checkbox选择
                            //   e.stopPropagation();
                            //   handleCategorySelect(category.id);
                            // }}
                            color="primary"
                            sx={{ mr: 1 }} // Checkbox 和文本之间的间距
                          />
                          <ListItemText 
                            primary={category.name} 
                            secondary={
                              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                <Chip 
                                  size="small" 
                                  label={t('painting.tools.randomPrompt.category.itemCount', { count: category.items.length })}
                                  variant="outlined" 
                                />
                                <Chip 
                                  size="small" 
                                  label={category.extractMode === 'random'
                                    ? t('painting.tools.randomPrompt.modes.random')
                                    : t('painting.tools.randomPrompt.modes.sequential')}
                                  variant="outlined" 
                                  color="secondary"
                                />
                              </Box>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  </Paper>
                </>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={handleCloseCollectionDialog}>{t('painting.tools.common.cancel')}</Button>
          <Button 
            onClick={handleSaveCollection} 
            variant="contained" 
            color="primary"
            startIcon={<SaveIcon />}
            disabled={categories.length === 0}
          >
            {t('painting.tools.common.save')}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* 示例预览对话框 */}
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
            {currentExample || t('painting.tools.randomPrompt.collection.emptyExample')}
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button 
            startIcon={<CasinoIcon />}
            onClick={() => {
              // 使用 currentCollectionForExample 来确保使用的是打开示例时的那个集合对象（或其最新版本）
              if (currentCollectionForExample) {
                // 为了确保拿到最新的配置（如果用户在打开示例后又编辑了但未保存），我们从 collections 数组中再找一次
                const latestVersionOfExampleCollection = collections.find(c => c.id === currentCollectionForExample.id);
                const collectionToGenerate = latestVersionOfExampleCollection || currentCollectionForExample;
                setCurrentExample(generateExample(collectionToGenerate, 'collection'));
              } else if (editingCollection) { // Fallback if currentCollectionForExample is somehow null
                 const latestVersionOfEditingCollection = collections.find(c => c.id === editingCollection.id);
                 const collectionToGenerate = latestVersionOfEditingCollection || editingCollection;
                 setCurrentExample(generateExample(collectionToGenerate, 'collection'));
              }
            }}
          >
            {t('painting.tools.randomPrompt.regenerate')}
          </Button>
          <Button onClick={handleCloseExample}>{t('painting.tools.common.close')}</Button>
        </DialogActions>
      </Dialog>
      
      {/* 提示消息 */}
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
        >
          {snackbar.messageKey ? t(snackbar.messageKey) : ''}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default CollectionForm;
